const $ = (id) => document.getElementById(id);
let me = null;

function el(tag, text, attrs) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;          // never innerHTML
    Object.assign(e, attrs || {});
    return e;
}
function badge(text, cls) { return el("span", text, { className: "badge " + (cls || "") }); }
let toastTimer;
function toast(text, ok) {
    const t = $("toast"); t.textContent = text;
    t.className = "show " + (ok ? "good" : "bad");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ""), 3500);
}
async function api(path, opts) {
    const r = await fetch(path, opts);
    let body = null;
    try { body = await r.json(); } catch (_) { }
    if (!r.ok) {
        const d = body && body.detail;
        throw new Error(Array.isArray(d) ? "Invalid input" : (d || r.statusText));
    }
    return body;
}
const json = (method, data) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const when = (ts) => new Date(ts).toLocaleString();

async function start() {
    try { me = await api("/auth/me"); } catch (_) { me = null; }
    $("loginBox").classList.toggle("hidden", !!me);
    $("app").classList.toggle("hidden", !me);
    $("userbar").classList.toggle("hidden", !me);
    if (!me) return;
    $("who").textContent = me.email; $("role").textContent = me.role;
    $("uploadBox").classList.toggle("hidden", me.role !== "owner");
    $("tabAudit").classList.toggle("hidden", me.role !== "admin");
    $("tabUsers").classList.toggle("hidden", me.role !== "admin");
    showTab("docs"); loadDocs();
}
function showTab(name) {
    for (const t of ["docs", "audit", "users"]) $("tab-" + t).classList.toggle("hidden", t !== name);
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    if (name === "audit") loadAudit();
    if (name === "users") loadUsers();
}
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- documents ----------
async function loadDocs() {
    const p = new URLSearchParams();
    for (const k of ["q", "owner", "category"]) if ($(k).value) p.set(k, $(k).value);
    if ($("from").value) p.set("date_from", $("from").value + "T00:00:00Z");
    if ($("to").value) p.set("date_to", $("to").value + "T23:59:59Z");
    const tb = $("docs"); tb.replaceChildren();
    try {
        const docs = await api("/documents?" + p);
        if (!docs.length) {
            const tr = el("tr"); tr.append(el("td", "Nothing here yet. Documents appear when you own them or someone grants you access.", { colSpan: 6 })); tb.append(tr);
        }
        for (const d of docs) {
            const tr = el("tr");
            const acc = el("td"); acc.append(badge(d.access, d.access === "owner" ? "owner" : ""));
            const act = el("td");
            const dl = el("button", "Download", { className: "small" }); dl.onclick = () => download(d);
            const det = el("button", "Details", { className: "small ghost" }); det.onclick = () => openDetails(d);
            act.append(dl, " ", det);
            tr.append(el("td", d.name), el("td", d.owner), el("td", d.category), el("td", when(d.created_at)), acc, act);
            tb.append(tr);
        }
    } catch (e) { toast(e.message); }
}
async function download(d) {
    const r = await fetch(`/documents/${encodeURIComponent(d.id)}/download`);
    if (!r.ok) return toast("Refused: you do not have access to this document (this attempt was recorded)");
    const url = URL.createObjectURL(await r.blob());
    const a = el("a", "", { href: url, download: d.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openDetails(d) {
    const dlg = $("dlg"); dlg.replaceChildren();
    const isOwner = d.access === "owner", canEdit = isOwner || d.access === "edit";
    dlg.append(el("h2", d.name));
    dlg.append(el("p", `Owner: ${d.owner} · ${d.category} · ${(d.size / 1024).toFixed(1)} KB · your access: ${d.access}`, { className: "mute" }));

    if (canEdit) {
        dlg.append(el("h3", "Edit details"));
        const row = el("div", "", { className: "row" });
        const n = el("input", "", { value: d.name, placeholder: "Name" });
        const c = el("input", "", { value: d.category, placeholder: "Category" });
        const s = el("button", "Save");
        s.onclick = async () => {
            try { await api(`/documents/${d.id}`, json("PATCH", { name: n.value, category: c.value })); toast("Saved", true); dlg.close(); loadDocs(); }
            catch (e) { toast(e.message); }
        };
        row.append(n, c, s); dlg.append(row);
    }
    if (isOwner) {
        dlg.append(el("h3", "Share"));
        const row = el("div", "", { className: "row" });
        const em = el("input", "", { placeholder: "Person's email" });
        const pm = el("select"); pm.append(el("option", "read"), el("option", "edit"));
        const g = el("button", "Grant access");
        const list = el("div");
        g.onclick = async () => {
            try { await api(`/documents/${d.id}/grants`, json("POST", { email: em.value, permission: pm.value })); toast("Access granted", true); em.value = ""; renderGrants(d, list); }
            catch (e) { toast(e.message); }
        };
        row.append(em, pm, g); dlg.append(row);
        dlg.append(el("h3", "Who has access")); dlg.append(list); renderGrants(d, list);
    }
    const foot = el("div", "", { className: "row", style: "margin-top:1rem;justify-content:space-between" });
    if (isOwner) {
        const del = el("button", "Delete document", { className: "danger" });
        del.onclick = async () => {
            if (!confirm("Delete this document for everyone?")) return;
            try { await api(`/documents/${d.id}`, { method: "DELETE" }); toast("Deleted", true); dlg.close(); loadDocs(); }
            catch (e) { toast(e.message); }
        };
        foot.append(del);
    } else foot.append(el("span"));
    const close = el("button", "Close", { className: "ghost" }); close.onclick = () => dlg.close();
    foot.append(close); dlg.append(foot);
    dlg.showModal();
}
async function renderGrants(d, box) {
    box.replaceChildren();
    try {
        const rows = await api(`/documents/${d.id}/grants`);
        if (!rows.length) box.append(el("p", "Nobody besides you.", { className: "mute" }));
        for (const g of rows) {
            const line = el("div", "", { className: "row", style: "justify-content:space-between;margin:.3rem 0" });
            const left = el("span", g.email + " "); left.append(badge(g.permission));
            const b = el("button", "Revoke", { className: "small danger" });
            b.onclick = async () => {
                try { await api(`/documents/${d.id}/grants/${g.user_id}`, { method: "DELETE" }); toast("Access revoked immediately", true); renderGrants(d, box); }
                catch (e) { toast(e.message); }
            };
            line.append(left, b); box.append(line);
        }
    } catch (e) { toast(e.message); }
}

// ---------- audit ----------
async function loadAudit() {
    const p = new URLSearchParams({ limit: "200" });
    if ($("fAction").value) p.set("action", $("fAction").value);
    if ($("fOutcome").value) p.set("outcome", $("fOutcome").value);
    if ($("fDoc").value.trim()) p.set("document_id", $("fDoc").value.trim());
    const tb = $("audit"); tb.replaceChildren();
    try {
        for (const e of await api("/admin/audit?" + p)) {
            const tr = el("tr"); const oc = el("td"); oc.append(badge(e.outcome, e.outcome));
            tr.append(el("td", String(e.id)), el("td", when(e.ts)), el("td", e.actor_email || "(not signed in)"),
                el("td", e.action), oc, el("td", e.document_id ? e.document_id.slice(0, 8) : "-"),
                el("td", e.target_email || "-"), el("td", e.ip || "-"), el("td", e.detail || ""));
            tb.append(tr);
        }
    } catch (e) { toast(e.message); }
}
$("auditBtn").onclick = loadAudit;
$("verifyBtn").onclick = async () => {
    try {
        const v = await api("/admin/audit/verify");
        $("verifyOut").textContent = v.intact
            ? `Chain intact. Head hash (record this externally): ${v.head_hash}`
            : `TAMPERING detected at row ${v.first_bad_row}`;
    } catch (e) { toast(e.message); }
};

// ---------- users ----------
async function loadUsers() {
    const tb = $("users"); tb.replaceChildren();
    try {
        for (const u of await api("/admin/users")) {
            const tr = el("tr"); const act = el("td");
            if (u.is_active && u.id !== me.id) {
                const b = el("button", "Disable", { className: "small danger" });
                b.onclick = async () => {
                    if (!confirm(`Disable ${u.email}? Their sessions end now.`)) return;
                    try { await api(`/admin/users/${u.id}/disable`, { method: "POST" }); toast("User disabled", true); loadUsers(); }
                    catch (e) { toast(e.message); }
                };
                act.append(b);
            }
            tr.append(el("td", u.email), el("td", u.role), el("td", u.is_active ? "active" : "disabled"), act);
            tb.append(tr);
        }
    } catch (e) { toast(e.message); }
}
$("nuBtn").onclick = async () => {
    try {
        await api("/admin/users", json("POST", { email: $("nuEmail").value, password: $("nuPw").value, role: $("nuRole").value }));
        toast("User created", true); $("nuEmail").value = ""; $("nuPw").value = ""; loadUsers();
    } catch (e) { toast(e.message); }
};

// ---------- auth / upload ----------
document.querySelectorAll("#demo tr").forEach((tr, i) => {
    if (i === 0) return;
    tr.onclick = () => { $("email").value = tr.cells[1].textContent; $("password").value = tr.cells[2].textContent; };
});
$("loginBtn").onclick = async () => {
    try { await api("/auth/login", json("POST", { email: $("email").value, password: $("password").value })); $("password").value = ""; start(); }
    catch (e) { toast(e.message); }
};
$("password").onkeydown = (e) => { if (e.key === "Enter") $("loginBtn").onclick(); };
$("logoutBtn").onclick = async () => { try { await api("/auth/logout", { method: "POST" }); } catch (_) { } start(); };
$("searchBtn").onclick = loadDocs;
$("uploadBtn").onclick = async () => {
    const f = $("file").files[0]; if (!f) return toast("Choose a file first");
    const fd = new FormData(); fd.append("file", f); fd.append("category", $("cat").value);
    try { await api("/documents", { method: "POST", body: fd }); toast("Uploaded", true); $("file").value = ""; loadDocs(); }
    catch (e) { toast(e.message); }
};
start();