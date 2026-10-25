from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from .audit import record
from .auth import current_user, get_db
from .documents import guard, ip_of
from .models import Grant, User, now

router = APIRouter(prefix="/documents", tags=["grants"])


class GrantIn(BaseModel):
    email: EmailStr
    permission: Literal["read", "edit"]   # anything else is a 422, so no 'owner' or 'admin' tricks


@router.post("/{doc_id}/grants")
def grant_access(doc_id: str, body: GrantIn, request: Request,
                 user: User = Depends(current_user), db=Depends(get_db)):
    doc = guard(db, user, doc_id, "grant", request)       # only the owner passes
    target = (db.query(User)
                .filter(User.email == body.email.lower().strip(),
                        User.is_active.is_(True)).first())
    if target is None:
        raise HTTPException(404, "User not found")
    if target.id == doc.owner_id:
        raise HTTPException(422, "Owner already has full access")

    existing = (db.query(Grant)
                  .filter(Grant.document_id == doc.id, Grant.user_id == target.id).first())
    if existing:
        existing.permission = body.permission
    else:
        db.add(Grant(document_id=doc.id, user_id=target.id,
                     permission=body.permission, granted_by=user.id))
    # record() commits, so the grant and its audit row are saved in ONE transaction.
    record(db, user.id, "grant", "allowed", document_id=doc.id,
           target_user_id=target.id, ip=ip_of(request), detail=f"permission={body.permission}")
    return {"document_id": doc.id, "user_id": target.id, "permission": body.permission}


@router.get("/{doc_id}/grants")
def list_grants(doc_id: str, request: Request,
                user: User = Depends(current_user), db=Depends(get_db)):
    doc = guard(db, user, doc_id, "grant", request)
    rows = (db.query(Grant, User).join(User, User.id == Grant.user_id)
              .filter(Grant.document_id == doc.id).all())
    return [{"user_id": u.id, "email": u.email, "permission": g.permission} for g, u in rows]


@router.delete("/{doc_id}/grants/{target_user_id}")
def revoke_access(doc_id: str, target_user_id: str, request: Request,
                  user: User = Depends(current_user), db=Depends(get_db)):
    doc = guard(db, user, doc_id, "grant", request)
    deleted = (db.query(Grant)
                 .filter(Grant.document_id == doc.id, Grant.user_id == target_user_id)
                 .delete())
    if deleted == 0:
        db.rollback()
        raise HTTPException(404, "No such grant")
    record(db, user.id, "revoke", "allowed", document_id=doc.id,
           target_user_id=target_user_id, ip=ip_of(request))
    return {"ok": True}


@router.delete("/{doc_id}")
def delete_document(doc_id: str, request: Request,
                    user: User = Depends(current_user), db=Depends(get_db)):
    doc = guard(db, user, doc_id, "delete", request)      # owner only
    doc.deleted_at = now()                                # soft delete: authorize() treats it as gone
    record(db, user.id, "delete", "allowed", document_id=doc.id, ip=ip_of(request))
    return {"ok": True}