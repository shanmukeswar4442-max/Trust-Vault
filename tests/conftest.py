import os
import tempfile

# Must be set BEFORE the app is imported.
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["STORAGE_DIR"] = f"{_tmp}/storage"
os.environ["COOKIE_SECURE"] = "0"

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.db import Base, SessionLocal, engine
from app.main import app
from app.models import User

PW = "Test-password-1"
USERS = {
    "admin":   ("admin@t.io", "admin"),
    "owner":   ("owner@t.io", "owner"),
    "owner2":  ("owner2@t.io", "owner"),
    "viewer":  ("viewer@t.io", "viewer"),
    "viewer2": ("viewer2@t.io", "viewer"),
}


@pytest.fixture(scope="session", autouse=True)
def seed():
    Base.metadata.create_all(engine)
    db = SessionLocal()
    for email, role in USERS.values():
        db.add(User(email=email, role=role, password_hash=hash_password(PW)))
    db.commit()
    db.close()


def login(name: str) -> TestClient:
    c = TestClient(app)          # each client has its own cookie jar
    r = c.post("/auth/login", json={"email": USERS[name][0], "password": PW})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture
def clients():
    return {n: login(n) for n in USERS}


@pytest.fixture
def doc(clients):
    """A document owned by 'owner', shared with nobody."""
    r = clients["owner"].post("/documents",
                              files={"file": ("salary.txt", b"TOP SECRET salary")},
                              data={"category": "hr"})
    assert r.status_code == 200, r.text
    return r.json()["id"]