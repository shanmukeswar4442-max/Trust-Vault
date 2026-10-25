# PROMPTS.md

An honest log of how I used AI (Claude) on TrustVault. I built this in one compressed day (25 Oct 2026), so every entry is dated that day. Entries marked **[AUTH]** or **[AUDIT]** are about authorisation, access control or the audit trail.

## Context and instructions I reused

I kept giving the AI the same ground rules, and I checked its output against them:

- "Deny by default. One `authorize(user, document, action)` function decides every document access. No route may skip it."
- "Revocation must work on the person's next request, so no cached permissions and no long-lived download links."
- "Refused attempts must be audited as well as allowed ones."
- "Return 404 for both missing and forbidden documents so existence isn't leaked."
- "Admins must not be able to read file contents unless granted."
- "Never use the client's filename as a path, and never trust the client's content type."
- My standing check: after any access-control change, run the tests, then remove one check on purpose and confirm tests fail.

## Entries

### 2026-10-25: Session design [AUTH]
- **Asked:** for a way to log users in and kill their access instantly.
- **Produced:** first a `token_version` scheme (JWT-style), later corrected to server-side sessions.
- **Wrong:** a stateless token cannot be revoked for one session without a database lookup, which breaks the "revocation is immediate" rule.
- **Did instead:** a `sessions` table storing only the SHA-256 of the cookie token. Logout deletes the row, and `current_user` rechecks `is_active` on every request. Proved with a replayed-cookie test (`test_logout_kills_replayed_cookie`). Commit: da0345b

### 2026-10-25: Seed accounts used a reserved email domain
- **Asked:** for a seed script with an admin, owner and viewer.
- **Produced:** accounts like `owner@trustvault.test`.
- **Wrong:** the email validator rejects `.test`, so login returned 422 every time. My first "replay test" showed 401 and looked like a pass, but it tested nothing, because I had never logged in.
- **Did instead:** switched to `@trustvault.io`, then re-ran the test with a real login and checked the status codes were 200, 200, 200, 401. Commit: b2bd973

### 2026-10-25: Upload and audit ordering [AUDIT]
- **Asked:** for upload, download and list routes with audit logging.
- **Produced:** an upload that committed the document first and wrote the audit row afterwards in a separate step.
- **Wrong:** a crash between the two would leave a document with no audit record, so the evidence could vanish.
- **Did instead:** for grants and revokes, the change and its audit row are saved in a single commit. I wrote `record()` to commit immediately so denied events survive the 404 that follows. I kept the upload ordering as a known partial gap in THREATS.md rather than claim it is fixed. Commit: ae6e5f4

### 2026-10-25: Weak revocation test [AUTH]
- **Asked:** for tests that prove revocation works on the same session.
- **Produced:** a test asserting the viewer's whole document list is empty after revoke.
- **Wrong:** all tests share one database, and an earlier test left a read grant behind, so the test failed for the wrong reason. The search-leak test had the same weakness and only passed because of test order.
- **Did instead:** assert that the specific revoked document is absent (`doc not in [...]`) and made the search test order-independent. Commit: <hash>

### 2026-10-25: Proving the tests actually test authorisation [AUTH]
- **Asked:** for attack tests covering cross-user access, revocation and audit.
- **Produced:** 16 tests that all passed.
- **Wrong (risk):** passing tests don't show they would catch a missing check.
- **Did instead:** I removed the `guard(...)` call from the download route. Six tests failed: stranger, admin, read-grantee, revoke, deleted document and denied-audit. I restored it and all passed again. Commit: <hash>

### 2026-10-25: Requirements gap: `edit` did nothing [AUTH] [AUDIT]
- **Asked:** me to check the build against the ten requirements.
- **Found:** the `edit` permission existed in the model, but no route used it. "Changes" were never audited, and failed logins weren't logged.
- **Did instead:** added `PATCH /documents/{id}` through `guard(..., "edit")`, audit entries for edits and logins, admin user create/disable (disabling deletes live sessions), and tests: `test_edit_permission_is_enforced`, `test_disabled_user_loses_live_session`, `test_only_admin_manages_users`. Commit: <hash>

### 2026-10-25: Deployment errors
- **Asked:** for Render deployment steps.
- **Produced:** `pip freeze > requirements.txt` and a `postgresql://` URL.
- **Wrong:** on Windows, `pip freeze` included Windows-only packages (`pywin32`) and broke the Render build. SQLAlchemy 2.x also assumed the psycopg v3 driver, which wasn't installed.
- **Did instead:** wrote a seven-line `requirements.txt` by hand and set the URL to `postgresql+psycopg2://` explicitly. Also fixed a rejected push (the remote had its own initial commit) by pulling before pushing. Commit: <hash>

### 2026-10-25: Front end bugs and demo login
- **Asked:** for a small UI, then a better React UI with one-click demo logins.
- **Produced:** a line that chained `.append()` onto the result of `.append()` (which returns nothing, so it throws), and demo passwords in the UI that did not match what the server had seeded.
- **Wrong:** the empty-list message would have crashed, and the one-click login failed with "Invalid credentials". The seed also only set passwords on first creation, so changing Render's environment variables had no effect.
- **Did instead:** rewrote the empty-state code, changed the seed to reset demo passwords when the `SEED_*_PW` variables are set, and made `demo.js` match them. Commit: <hash>

### 2026-10-25: Planning assumption
- **Asked:** for a build plan.
- **Produced:** a seven-day, then five-day schedule.
- **Wrong:** the deadline was the same day, which my own server's date header showed. The plan was unrealistic.
- **Did instead:** cut scope (no AI suggestions, versions, groups, external sharing or rate limiting) and listed each cut in THREATS.md and the README rather than hiding it.

## Where the AI was right, and what I checked

The `authorize()` function in `app/authz.py` was correct on first reading, and I reviewed it line by line: the only `return doc` lines are the explicit allow paths, and everything else falls to `_deny()`. I checked it by the mutation test above rather than only by reading it.
