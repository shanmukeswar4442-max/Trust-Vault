from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from .audit import record, verify_chain
from .auth import get_db, hash_password, require_role
from .documents import ip_of
from .models import AuditEvent, Session, User

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/audit")
def audit_log(action: str | None = None, outcome: str | None = None,
              document_id: str | None = None, limit: int = 100,
              admin: User = Depends(require_role("admin")), db=Depends(get_db)):
    """Admins see WHO did WHAT to which document, never the file contents."""
    q = db.query(AuditEvent)
    if action:
        q = q.filter(AuditEvent.action == action)
    if outcome:
        q = q.filter(AuditEvent.outcome == outcome)
    if document_id:
        q = q.filter(AuditEvent.document_id == document_id)
    rows = q.order_by(AuditEvent.id.desc()).limit(max(1, min(limit, 500))).all()
    emails = {u.id: u.email for u in db.query(User)}
    return [{"id": e.id, "ts": e.ts, "actor_id": e.actor_id,
             "actor_email": emails.get(e.actor_id), "action": e.action,
             "outcome": e.outcome, "document_id": e.document_id,
             "target_user_id": e.target_user_id,
             "target_email": emails.get(e.target_user_id),
             "ip": e.ip, "detail": e.detail} for e in rows]


@router.get("/audit/verify")
def audit_verify(admin: User = Depends(require_role("admin")), db=Depends(get_db)):
    bad = verify_chain(db)
    last = db.query(AuditEvent).order_by(AuditEvent.id.desc()).first()
    return {"intact": bad is None, "first_bad_row": bad,
            "head_hash": last.hash if last else None}


class NewUser(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    role: Literal["admin", "owner", "viewer"]


@router.get("/users")
def list_users(admin: User = Depends(require_role("admin")), db=Depends(get_db)):
    return [{"id": u.id, "email": u.email, "role": u.role, "is_active": u.is_active}
            for u in db.query(User).order_by(User.created_at)]


@router.post("/users")
def create_user(body: NewUser, request: Request,
                admin: User = Depends(require_role("admin")), db=Depends(get_db)):
    email = body.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "Email already exists")
    u = User(email=email, role=body.role, password_hash=hash_password(body.password))
    db.add(u)
    record(db, admin.id, "user_create", "allowed", target_user_id=u.id,
           ip=ip_of(request), detail=f"role={body.role}")
    return {"id": u.id, "email": u.email, "role": u.role}


@router.post("/users/{user_id}/disable")
def disable_user(user_id: str, request: Request,
                 admin: User = Depends(require_role("admin")), db=Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(422, "You cannot disable yourself")
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User not found")
    u.is_active = False
    db.query(Session).filter(Session.user_id == u.id).delete()   # kill live sessions now
    record(db, admin.id, "user_disable", "allowed", target_user_id=u.id, ip=ip_of(request))
    return {"ok": True}