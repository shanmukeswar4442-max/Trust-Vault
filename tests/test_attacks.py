from fastapi.testclient import TestClient

from app.audit import verify_chain
from app.db import SessionLocal
from app.main import app
from app.models import AuditEvent
from tests.conftest import USERS


def uid(clients, name):
    return clients[name].get("/auth/me").json()["id"]


def share(clients, doc, who, perm="read"):
    r = clients["owner"].post(f"/documents/{doc}/grants",
                              json={"email": USERS[who][0], "permission": perm})
    assert r.status_code == 200, r.text


# ---- Rule 1: only granted people can reach a document ----

def test_unauthenticated_gets_nothing(doc):
    c = TestClient(app)
    assert c.get(f"/documents/{doc}/download").status_code == 401
    assert c.get("/documents").status_code == 401


def test_stranger_cannot_download(clients, doc):
    assert clients["viewer"].get(f"/documents/{doc}/download").status_code == 404
    assert clients["owner2"].get(f"/documents/{doc}/download").status_code == 404


def test_stranger_cannot_delete_or_manage_grants(clients, doc):
    v = clients["viewer"]
    assert v.delete(f"/documents/{doc}").status_code == 404
    assert v.get(f"/documents/{doc}/grants").status_code == 404
    r = v.post(f"/documents/{doc}/grants",
               json={"email": USERS["viewer"][0], "permission": "edit"})
    assert r.status_code == 404
    assert clients["owner"].get(f"/documents/{doc}/download").status_code == 200


def test_admin_cannot_read_contents(clients, doc):
    assert clients["admin"].get(f"/documents/{doc}/download").status_code == 404


def test_search_does_not_leak(clients, doc):
    assert clients["viewer"].get("/documents?q=salary").json() == []
    assert clients["owner2"].get("/documents?category=hr").json() == []
    assert any(d["id"] == doc for d in clients["owner"].get("/documents?q=salary").json())


def test_read_grantee_cannot_delete_or_regrant(clients, doc):
    share(clients, doc, "viewer", "read")
    v = clients["viewer"]
    assert v.get(f"/documents/{doc}/download").status_code == 200
    assert v.delete(f"/documents/{doc}").status_code == 404
    r = v.post(f"/documents/{doc}/grants",
               json={"email": USERS["viewer2"][0], "permission": "read"})
    assert r.status_code == 404
    assert clients["viewer2"].get(f"/documents/{doc}/download").status_code == 404


def test_viewer_cannot_upload(clients):
    r = clients["viewer"].post("/documents", files={"file": ("a.txt", b"x")})
    assert r.status_code == 403


def test_mass_assignment_rejected(clients, doc):
    r = clients["owner"].post(f"/documents/{doc}/grants",
                              json={"email": USERS["viewer"][0], "permission": "owner"})
    assert r.status_code == 422


# ---- Rule 3: revocation is immediate ----

def test_revoke_works_on_the_same_session(clients, doc):
    share(clients, doc, "viewer")
    v = clients["viewer"]
    assert v.get(f"/documents/{doc}/download").status_code == 200
    r = clients["owner"].delete(f"/documents/{doc}/grants/{uid(clients, 'viewer')}")
    assert r.status_code == 200
    assert v.get(f"/documents/{doc}/download").status_code == 404
    assert doc not in [d["id"] for d in v.get("/documents").json()]


def test_deleted_document_is_gone_for_everyone(clients, doc):
    share(clients, doc, "viewer")
    assert clients["owner"].delete(f"/documents/{doc}").status_code == 200
    assert clients["viewer"].get(f"/documents/{doc}/download").status_code == 404
    assert clients["owner"].get(f"/documents/{doc}/download").status_code == 404


def test_logout_kills_replayed_cookie(clients):
    c = clients["viewer"]
    token = c.cookies.get("tv_session")
    assert c.post("/auth/logout").status_code == 200
    stolen = TestClient(app)
    stolen.cookies.set("tv_session", token)
    assert stolen.get("/auth/me").status_code == 401


# ---- Rule 2: the audit trail ----

def test_denied_attempts_are_audited(clients, doc):
    clients["viewer"].get(f"/documents/{doc}/download")
    rows = clients["admin"].get(f"/admin/audit?outcome=denied&document_id={doc}").json()
    assert any(r["action"] == "download" and r["actor_id"] == uid(clients, "viewer")
               for r in rows)


def test_only_admin_sees_audit(clients):
    assert clients["viewer"].get("/admin/audit").status_code == 403
    assert clients["owner"].get("/admin/audit").status_code == 403


def test_tampering_with_audit_is_detected(clients, doc):
    clients["owner"].get(f"/documents/{doc}/download")
    db = SessionLocal()
    assert verify_chain(db) is None
    e = db.query(AuditEvent).order_by(AuditEvent.id).first()
    original = e.outcome
    e.outcome = "denied" if original == "allowed" else "allowed"
    db.commit()
    assert verify_chain(db) == e.id
    e.outcome = original
    db.commit()
    assert verify_chain(db) is None
    db.close()


# ---- Upload validation ----

def test_executable_upload_rejected(clients):
    r = clients["owner"].post("/documents", files={"file": ("a.pdf", b"MZ\x90\x00\x03\x00")})
    assert r.status_code == 415


def test_path_traversal_filename_is_harmless(clients):
    r = clients["owner"].post("/documents",
                              files={"file": ("../../app/main.py", b"hello")})
    assert r.status_code == 200
    assert r.json()["name"] == "main.py"
def test_search_does_not_leak(clients, doc):
    viewer_ids = [d["id"] for d in clients["viewer"].get("/documents?q=salary").json()]
    owner2_ids = [d["id"] for d in clients["owner2"].get("/documents?category=hr").json()]
    assert doc not in viewer_ids
    assert doc not in owner2_ids
    assert doc in [d["id"] for d in clients["owner"].get("/documents?q=salary").json()]

    