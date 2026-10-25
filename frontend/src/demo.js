// EDIT: these must match SEED_ADMIN_PW / SEED_OWNER_PW / SEED_VIEWER_PW on Render.
// Throwaway demo accounts, public by design.
export const DEMO=[
 {role:'admin', email:'admin@trustvault.io', pw:'Admin-local-pw-1', does:'Manages people and reads the audit trail. Cannot open file contents.'},
 {role:'owner', email:'owner@trustvault.io', pw:'Owner-local-pw-1', does:'Uploads documents, shares them, takes access back.'},
 {role:'viewer',email:'viewer@trustvault.io',pw:'Viewer-local-pw-1',does:'Opens only what an owner has granted.'}]
