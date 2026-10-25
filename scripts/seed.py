import os

from app.auth import hash_password
from app.db import Base, SessionLocal, engine
from app import models  # noqa: F401
from app.models import User

# Demo accounts. Passwords come from env vars so real ones never sit in Git.
# The defaults below are for LOCAL use only.
ACCOUNTS = [
    ("admin@trustvault.io", "admin",  os.getenv("SEED_ADMIN_PW",  "Admin-local-pw-1")),
    ("owner@trustvault.io", "owner",  os.getenv("SEED_OWNER_PW",  "Owner-local-pw-1")),
    ("viewer@trustvault.io", "viewer", os.getenv("SEED_VIEWER_PW", "Viewer-local-pw-1")),
]

ENV_NAMES = {"admin": "SEED_ADMIN_PW", "owner": "SEED_OWNER_PW", "viewer": "SEED_VIEWER_PW"}


def main():
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        for email, role, pw in ACCOUNTS:
            user = db.query(User).filter(User.email == email).first()
            if user is None:
                db.add(User(email=email, role=role, password_hash=hash_password(pw)))
                print(f"created: {email} ({role})")
            elif os.getenv(ENV_NAMES[role]):
                user.password_hash = hash_password(pw)
                user.is_active = True
                print(f"password reset: {email}")
            else:
                print(f"exists: {email}")
        db.commit()
    finally:
        db.close()

if __name__ == "__main__":
    main()