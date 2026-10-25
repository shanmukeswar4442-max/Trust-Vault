# PROMPTS.md

Honest log of how I used AI on TrustVault. Entries are written as I go.

## Reusable context I give the AI
(I'll add the instructions I reuse here, e.g. "deny by default, one authorize() function")

## Entries

### 2026-10-20: Plan and project setup
- **Asked:** for a plan and step-by-step setup for the TrustVault challenge.
- **Produced:** a 5-day plan, FastAPI + SQLAlchemy stack, folder layout.
- **Wrong / needed checking:** (to fill in as I find issues)
- **Did instead:** (commit link)

### 2026-10-20: Data model
- **Asked:** for the database tables for per-document grants, sessions and a hash-chained audit log.
- **Produced:** 4 tables plus `token_version` on users for session killing.
- **Wrong / needed checking:** The AI first suggested JWT-style `token_version`, then later corrected itself to server-side sessions, because stateless tokens can't be revoked without a DB lookup, which breaks the "revocation is immediate" rule. It also used plain `DateTime`, which on SQLite returns naive datetimes and would crash the expiry check.
- **Did instead:** Added a `sessions` table storing hashed tokens, removed `token_version`, and wrote a `UTCDateTime` type. Commit: <paste hash after committing>
### 2026-10-20: Authentication
- **Asked:** for login/logout and a way to kill sessions instantly.
- **Produced:** first a `token_version` scheme, then server-side sessions with hashed tokens.
- **Wrong / needed checking:** the token_version idea is JWT-style and cannot revoke without a DB check; the first auth sketch also defaulted the cookie `secure` flag in a way that is easy to forget in production.
- **Did instead:** sessions table with hashed tokens, `is_active` re-checked on every request, `secure` cookie default ON. Commit: <hash>
### 2026-10-25: Mutation check on authorisation
- **Asked:** for attack tests covering cross-user access, revocation and audit.
- **Produced:** 16 tests.
- **Wrong / checked:** one revocation test asserted the whole list was empty and failed for the wrong reason (shared test DB). Fixed to check the specific document. Then I removed the guard from download: 6 tests failed (stranger, admin, read-grantee, revoke, deleted, audit), proving they test the check.
- **Did instead:** restored the guard. Commit: <hash>