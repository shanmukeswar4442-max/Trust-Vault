const $ = (id) => document.getElementById(id);
let me = null;

function el(tag, text, attrs) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;      // never innerHTML
    Object.assign(e, attrs || {});
    return e;
}
function say(text, ok) { const m = $("msg"); m.textContent = text; m.className = ok ? "ok" : "err"; }

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
const json = (method, data) => ({
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
});

async function start() {
    try { me = await api("/auth/me"); } catch (_) { me = null; }
    $("loginBox").classList.toggle("hidden", !!me);
    $("app").classList.toggle("hidden", !me);
    if (!me) return;
    $("who").textContent = `${me.email} (${me.role})`;
    $("uploadBox").classList.toggle("hidden", me.role !== "owner");
    $("adminBox").classList.toggle("hidden", me.role !== "admin");
    loadDocs();
}

async function loadDocs() {
    const p = new URLSearchParams();
    for (const k of ["q", "owner", "category"]) if ($(k).value) p.set(k, $(k).value);
    if ($("from").value) p.set("date_from", $("from").value + "T00:00:00Z");
    if ($("to").value) p.set("date_to", $("to").value + "T23:59:59Z");
    const tb = $("docs"); tb.replaceChildren();
    try {
        const docs = await api("/documents?" + p);
        if (!docs.length) {
            const tr = el("tr");
            tr.append(el("td", "No documents", { colSpan: 5 }));
            tb.append(tr);
        }
        for (const d of docs) {
            const tr = el("tr");
            tr.append(el("td", d.name), el("td", d.owner), el("td", d.category), el("td", d.access));
            const act = el("td");
            act.append(el("a", "Download", { href: `/documents/${encodeURIComponent(d.id)}/download` }));
            if (d.access === "owner") {
                const share = el("button", "Share"); share.onclick = () => shareDoc(d.id);
                const acc = el("button", "Access"); acc.onclick = () => showGrants(d.id);
                const del = el("button", "Delete"); del.onclick = () => delDoc(d.id);
                act.append(" ", share, acc, del);
            }
            tr.append(act); tb.append(tr);
        }
    } catch (e) { say(e.message); }
}

async function shareDoc(id) {
    const email = prompt("Email of the person to share with:"); if (!email) return;
    const permission = prompt("Permission: read or edit", "read"); if (!permission) return;
    try {
        await api(`/documents/${id}/grants`, json("POST", { email, permission }));
        say("Access granted", true); showGrants(id);
    } catch (e) { say(e.message); }
}

async function showGrants(id) {
    const box = $("grants"); box.replaceChildren();
    try {
        const rows = await api(`/documents/${id}/grants`);
        box.append(el("h3", "Who has access"));
        if (!rows.length) box.append(el("p", "Nobody besides you."));
        for (const g of rows) {
            const line = el("p", `${g.email}: ${g.permission} `);
            const b = el("button", "Revoke");
            b.onclick = async () => {
                try {
                    await api(`/documents/${id}/grants/${g.user_id}`, { method: "DELETE" });
                    say("Access revoked", true); showGrants(id);
                } catch (e) { say(e.message); }
            };
            line.append(b); box.append(line);
        }
    } catch (e) { say(e.message); }
}

async function delDoc(id) {
    if (!confirm("Delete this document?")) return;
    try {
        await api(`/documents/${id}`, { method: "DELETE" });
        say("Deleted", true); loadDocs(); $("grants").replaceChildren();
    } catch (e) { say(e.message); }
}

$("loginBtn").onclick = async () => {
    try {
        await api("/auth/login", json("POST", { email: $("email").value, password: $("password").value }));
        $("password").value = ""; say(""); start();
    } catch (e) { say(e.message); }
};
$("logoutBtn").onclick = async () => { try { await api("/auth/logout", { method: "POST" }); } catch (_) { } start(); };
$("searchBtn").onclick = loadDocs;
$("uploadBtn").onclick = async () => {
    const f = $("file").files[0]; if (!f) return say("Choose a file first");
    const fd = new FormData(); fd.append("file", f); fd.append("category", $("cat").value);
    try { await api("/documents", { method: "POST", body: fd }); say("Uploaded", true); loadDocs(); }
    catch (e) { say(e.message); }
};
$("auditBtn").onclick = async () => {
    const tb = $("audit"); tb.replaceChildren();
    try {
        for (const e of await api("/admin/audit?limit=200")) {
            const tr = el("tr");
            for (const v of [e.id, e.ts, e.actor_id || "-", e.action, e.outcome,
            e.document_id || "-", e.target_user_id || "-", e.ip || "-"])
                tr.append(el("td", String(v)));
            tb.append(tr);
        }
    } catch (e) { say(e.message); }
};
$("verifyBtn").onclick = async () => {
    try {
        const v = await api("/admin/audit/verify");
        $("verifyOut").textContent = v.intact
            ? `Chain intact. Head hash: ${v.head_hash}`
            : `TAMPERING detected at row ${v.first_bad_row}`;
    } catch (e) { say(e.message); }
};
start();