import hashlib
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession

from .db import SessionLocal
from .models import User, Session, now

ph = PasswordHasher()
# Used so a login for an unknown email takes about as long as a real one.
DUMMY_HASH = ph.hash("not-a-real-password")

SESSION_COOKIE = "tv_session"
SESSION_TTL = timedelta(hours=8)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    return ph.hash(password)


def verify_credentials(db: DBSession, email: str, password: str) -> User | None:
    user = db.query(User).filter(User.email == email.lower().strip()).first()
    try:
        # Always run one verify, even for unknown emails (stops timing-based user enumeration).
        ph.verify(user.password_hash if user else DUMMY_HASH, password)
    except (VerifyMismatchError, InvalidHashError):
        return None
    if user is None or not user.is_active:
        return None
    return user


def create_session(db: DBSession, user: User) -> str:
    token = secrets.token_urlsafe(32)  # 256 bits of randomness
    db.add(Session(token_hash=hash_token(token), user_id=user.id,
                   expires_at=now() + SESSION_TTL))
    db.commit()
    return token  # only the raw token goes to the browser


def current_user(tv_session: str | None = Cookie(default=None),
                 db: DBSession = Depends(get_db)) -> User:
    """Dependency: returns the logged-in user or raises 401."""
    if not tv_session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    s = db.get(Session, hash_token(tv_session))
    if s is None or s.expires_at <= now():
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = db.get(User, s.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_role(*roles: str):
    """Dependency factory: restricts a route to certain global roles.
    This is NOT document permission. Role alone never opens a document."""
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return dep