import os
from .audit import record
from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, Request
from pydantic import BaseModel, EmailStr
from .documents import router as documents_router
from .grants import router as grants_router
from .admin import router as admin_router
from .auth import (SESSION_COOKIE, SESSION_TTL, create_session, current_user,
                   get_db, hash_token, verify_credentials)
from .db import Base, engine
from . import models
from pathlib import Path
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from .models import Session, User
from .documents import router as documents_router
from .grants import router as grants_router
Base.metadata.create_all(engine)

app = FastAPI(title="TrustVault")


app.include_router(documents_router)
app.include_router(grants_router)
app.include_router(admin_router)

STATIC = Path(__file__).resolve().parent.parent / "static"
CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"

app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(STATIC / "index.html",
                        headers={"Content-Security-Policy": CSP,
                                 "X-Content-Type-Options": "nosniff",
                                 "Cache-Control": "no-store"})
class LoginIn(BaseModel):
    email: EmailStr
    password: str


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db=Depends(get_db)):
    ip = request.client.host if request.client else None
    user = verify_credentials(db, body.email, body.password)
    if user is None:
        record(db, None, "login", "denied", ip=ip, detail=f"email={body.email[:100]}")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_session(db, user)
    record(db, user.id, "login", "allowed", ip=ip)
    response.set_cookie(
        SESSION_COOKIE, token,
        httponly=True,                       # JavaScript cannot read it
        samesite="strict",                   # not sent on cross-site requests (CSRF defence)
        secure=os.getenv("COOKIE_SECURE", "1") == "1",
        max_age=int(SESSION_TTL.total_seconds()),
        path="/",
    )
    return {"id": user.id, "email": user.email, "role": user.role}


@app.post("/auth/logout")
def logout(response: Response,
           user: User = Depends(current_user),
           tv_session: str | None = Cookie(default=None),
           db=Depends(get_db)):
    db.query(Session).filter(Session.token_hash == hash_token(tv_session)).delete()
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/auth/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email, "role": user.role}

