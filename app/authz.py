from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from .models import Document, Grant, User

# What each document-level permission allows. Anything not listed is denied.
GRANT_ALLOWS = {
    "read": {"read", "download"},
    "edit": {"read", "download", "edit"},
}
# The owner of a document can do everything to it, including delete and grant.
OWNER_ALLOWS = {"read", "download", "edit", "delete", "grant"}


def authorize(db: DBSession, user: User, document_id: str, action: str) -> Document:
    """The ONLY place that decides whether a user may touch a document.
    Deny by default. Returns the document if allowed, otherwise raises 404."""
    if action not in OWNER_ALLOWS:
        raise ValueError(f"unknown action: {action}")   # programmer error, never allow

    doc = db.get(Document, document_id)
    if doc is None or doc.deleted_at is not None:
        _deny()

    if doc.owner_id == user.id:
        if action in OWNER_ALLOWS:
            return doc

    grant = (db.query(Grant)
               .filter(Grant.document_id == document_id, Grant.user_id == user.id)
               .first())
    if grant is not None and action in GRANT_ALLOWS.get(grant.permission, set()):
        return doc

    _deny()


def _deny():
    # 404, not 403, so an outsider cannot tell "exists but forbidden" from "doesn't exist".
    raise HTTPException(status_code=404, detail="Not found")