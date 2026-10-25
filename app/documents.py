import hashlib
import os
import re
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_

from .audit import record
from .auth import current_user, get_db, require_role
from .authz import authorize
from .models import Document, Grant, User, new_id

router = APIRouter(prefix="/documents", tags=["documents"])

STORAGE_DIR = Path(os.getenv("STORAGE_DIR", "storage"))
MAX_BYTES = 5 * 1024 * 1024
CATEGORY_RE = re.compile(r"^[A-Za-z0-9 _-]{1,50}$")


def sniff_type(data: bytes) -> str | None:
    """Decide the type from the bytes, never from the client's filename or header."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    try:
        data.decode("utf-8")
        if b"\x00" not in data:
            return "text/plain"
    except UnicodeDecodeError:
        pass
    return None


def clean_name(raw: str) -> str:
    name = os.path.basename((raw or "").replace("\\", "/"))
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return name[:255] or "unnamed"


def ip_of(request: Request) -> str | None:
    return request.client.host if request.client else None


def guard(db, user: User, doc_id: str, action: str, request: Request) -> Document:
    """authorize() plus audit. Denied attempts are logged BEFORE the 404 goes out."""
    try:
        return authorize(db, user, doc_id, action)
    except HTTPException:
        record(db, user.id, action, "denied", document_id=doc_id[:32], ip=ip_of(request))
        raise


@router.post("")
async def upload(request: Request,
                 file: UploadFile = File(...),
                 category: str = Form("general"),
                 user: User = Depends(require_role("owner")),
                 db=Depends(get_db)):
    def reject(status: int, reason: str):
        record(db, user.id, "upload", "denied", ip=ip_of(request), detail=reason)
        raise HTTPException(status, reason)

    if not CATEGORY_RE.match(category):
        reject(422, "Invalid category")

    data = bytearray()
    while chunk := await file.read(64 * 1024):
        data += chunk
        if len(data) > MAX_BYTES:
            reject(413, "File too large (max 5 MB)")
    if not data:
        reject(422, "Empty file")

    ctype = sniff_type(bytes(data))
    if ctype is None:
        reject(415, "Unsupported file type (allowed: pdf, png, jpg, txt)")

    name = clean_name(file.filename)
    doc = Document(owner_id=user.id, name=name, category=category.strip(),
                   content_type=ctype, size=len(data),
                   sha256=hashlib.sha256(data).hexdigest())
    doc.storage_key = new_id()
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    (STORAGE_DIR / doc.storage_key).write_bytes(data)
    db.add(doc)
    db.commit()
    record(db, user.id, "upload", "allowed", document_id=doc.id, ip=ip_of(request),
           detail=f"name={name} type={ctype} size={len(data)}")
    return {"id": doc.id, "name": doc.name, "category": doc.category, "size": doc.size}


@router.get("")
def list_documents(q: str | None = None, owner: str | None = None,
                   category: str | None = None,
                   date_from: datetime | None = None, date_to: datetime | None = None,
                   user: User = Depends(current_user), db=Depends(get_db)):
    """Search by name, owner email, category and date. The access filter is
    always applied first, inside the query, so search can never reveal other people's files."""
    def utc(d):
        return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)

    granted = db.query(Grant.document_id).filter(Grant.user_id == user.id)
    query = (db.query(Document, User)
               .join(User, User.id == Document.owner_id)
               .filter(Document.deleted_at.is_(None),
                       or_(Document.owner_id == user.id, Document.id.in_(granted))))
    if q:
        query = query.filter(Document.name.ilike(f"%{q}%"))
    if owner:
        query = query.filter(User.email.ilike(f"%{owner}%"))
    if category:
        query = query.filter(Document.category == category)
    if date_from:
        query = query.filter(Document.created_at >= utc(date_from))
    if date_to:
        query = query.filter(Document.created_at <= utc(date_to))

    perms = {g.document_id: g.permission
             for g in db.query(Grant).filter(Grant.user_id == user.id)}
    return [{"id": d.id, "name": d.name, "category": d.category, "size": d.size,
             "owner": o.email, "created_at": d.created_at,
             "access": "owner" if d.owner_id == user.id else perms.get(d.id)}
            for d, o in query.order_by(Document.created_at.desc()).limit(200).all()]


@router.get("/{doc_id}/download")
def download(doc_id: str, request: Request,
             user: User = Depends(current_user), db=Depends(get_db)):
    doc = guard(db, user, doc_id, "download", request)          # <-- THE decision
    path = STORAGE_DIR / doc.storage_key
    if not path.is_file():
        raise HTTPException(500, "Stored file missing")
    record(db, user.id, "download", "allowed", document_id=doc.id, ip=ip_of(request))
    return FileResponse(
        path, media_type=doc.content_type, filename=doc.name,
        content_disposition_type="attachment",                  # never render inline
        headers={"X-Content-Type-Options": "nosniff",
                 "Cache-Control": "no-store"})