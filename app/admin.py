from fastapi import APIRouter, Depends

from .audit import verify_chain
from .auth import get_db, require_role
from .models import AuditEvent, User

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
    return [{"id": e.id, "ts": e.ts, "actor_id": e.actor_id, "action": e.action,
             "outcome": e.outcome, "document_id": e.document_id,
             "target_user_id": e.target_user_id, "ip": e.ip, "detail": e.detail}
            for e in rows]


@router.get("/audit/verify")
def audit_verify(admin: User = Depends(require_role("admin")), db=Depends(get_db)):
    bad = verify_chain(db)
    last = db.query(AuditEvent).order_by(AuditEvent.id.desc()).first()
    return {"intact": bad is None, "first_bad_row": bad,
            "head_hash": last.hash if last else None}   # record this externally