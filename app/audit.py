import hashlib
import json
from threading import Lock

from sqlalchemy.orm import Session as DBSession

from .models import AuditEvent, now

GENESIS = "0" * 64
_lock = Lock()  # serialises writes so the chain can't fork (single-process only; see THREATS.md)


def compute_hash(prev_hash, ts, actor_id, action, outcome,
                 document_id, target_user_id, ip, detail) -> str:
    # JSON encoding means a hostile filename can't forge fields or inject log lines.
    payload = json.dumps(
        [prev_hash, ts.isoformat(), actor_id, action, outcome,
         document_id, target_user_id, ip, detail],
        separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def record(db: DBSession, actor_id, action, outcome, document_id=None,
           target_user_id=None, ip=None, detail="") -> None:
    """Append one event and COMMIT immediately, so evidence survives a later error."""
    detail = (detail or "")[:500]
    with _lock:
        last = db.query(AuditEvent).order_by(AuditEvent.id.desc()).first()
        prev = last.hash if last else GENESIS
        ts = now()
        h = compute_hash(prev, ts, actor_id, action, outcome,
                         document_id, target_user_id, ip, detail)
        db.add(AuditEvent(ts=ts, actor_id=actor_id, action=action, outcome=outcome,
                          document_id=document_id, target_user_id=target_user_id,
                          ip=ip, detail=detail, prev_hash=prev, hash=h))
        db.commit()


def verify_chain(db: DBSession):
    """Returns None if the chain is intact, otherwise the id of the first bad row."""
    prev = GENESIS
    for e in db.query(AuditEvent).order_by(AuditEvent.id):
        expected = compute_hash(prev, e.ts, e.actor_id, e.action, e.outcome,
                                e.document_id, e.target_user_id, e.ip, e.detail)
        if e.prev_hash != prev or e.hash != expected:
            return e.id
        prev = e.hash
    return None