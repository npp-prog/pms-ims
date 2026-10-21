// Administration: users and roles, settings, audit trail — and every user's own profile.
import { auth, updatePassword, EmailAuthProvider, reauthenticateWithCredential, authError } from "../fb.js";
import { S, isSuper, settings } from "../state.js";
import { $, esc, busy, toast, fmtDate, fmtDateTime, opts, renderTable, openModal, userBadge, avatar } from "../ui.js";
import { ROLES, ROLE_NAMES } from "../core/catalog.js";
import { setUserAccess, saveSettings, updateProfile } from "../data.js";

const ROLE_HELP = {
  enduser: "Encodes AIRs for deliveries to their office; sees the PAR / ICS / RIS issued from them.",
  gso: "Inspects and approves or returns AIRs; issues PAR, ICS and RIS.",
  accounting: "Marks AIR receipts and PAR / ICS / RIS as posted in the registry.",
  admin: "Everything above, plus users, roles and settings.",
  superadmin: "Everything, including assigning administrators."
};

export function users(main) {
  const rows = [...S.d.users].sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0) || String(a.displayName).localeCompare(String(b.displayName)));
  main.innerHTML = `<div class="page-head"><div><h1>Users &amp; Roles</h1><p>Approve new registrations and assign each person one role. ${isSuper() ? "" : "Only the Super Administrator can assign or change administrators."}</p></div></div>
    <div class="card"><dl class="kv">${ROLES.map(r => `<dt>${esc(ROLE_NAMES[r])}</dt><dd class="small">${esc(ROLE_HELP[r])}</dd>`).join("")}</dl></div>
    <div class="card" id="t"></div>`;
  renderTable($("#t", main), {
    id: "users", rows, pageSize: 50,
    searchText: u => `${u.displayName} ${u.email} ${u.office} ${u.position}`,
    filters: [{ key: "s", label: "Status", options: [["pending", "Pending approval"], ["active", "Active"], ["disabled", "Disabled"], ["declined", "Declined"]], test: (u, v) => u.status === v },
      { key: "r", label: "Role", options: ROLES.map(r => [r, ROLE_NAMES[r]]), test: (u, v) => u.role === v && u.status === "active" }],
    columns: [
      { label: "Name", render: u => `<div class="btn-row" style="flex-wrap:nowrap">${avatar(u, "sm")}<div><b>${esc(u.displayName)}</b><div class="xs muted">${esc(u.email)}</div></div></div>`, sort: u => u.displayName || "" },
      { label: "Office / position", render: u => `${esc(u.office)}<div class="xs muted">${esc(u.position)}</div>`, sort: u => u.office || "" },
      { label: "Role", render: u => u.status === "pending" ? `<span class="muted">—</span>` : esc(ROLE_NAMES[u.role] || u.role), sort: u => u.role },
      { label: "Status", render: u => userBadge(u.status), sort: u => u.status },
      { label: "Registered", render: u => fmtDate(u.createdAt), sort: u => u.createdAt?.seconds || 0 }
    ],
    empty: "No users yet.",
    onRow: u => editUser(u)
  });
}
users.deps = ["r:users"];

function editUser(u) {
  if (u.id === S.user.uid) return toast("You can't change your own role or status. Ask another administrator.", "err");
  if (["admin", "superadmin"].includes(u.role) && !isSuper()) return toast("Only the Super Administrator can change an administrator's account.", "err");
  const roles = ROLES.filter(r => isSuper() || !["admin", "superadmin"].includes(r));
  const m = openModal(`<h2>${esc(u.displayName || u.email)}</h2><p class="muted small">${esc(u.email)} · ${esc(u.office)} · ${esc(u.position)}${u.contact ? ` · ${esc(u.contact)}` : ""}</p>
    <form class="grid" id="uf">
      <div><label>Role</label><select name="role">${opts(roles.map(r => [r, ROLE_NAMES[r]]), roles.includes(u.role) ? u.role : "enduser")}</select><div class="xs muted" id="rh"></div></div>
      <div><label>Status</label><select name="status">${opts([["active", "Active — can use the system"], ["pending", "Pending approval"], ["disabled", "Disabled"], ["declined", "Declined"]], u.status === "pending" ? "active" : u.status)}</select></div>
      <div><label>Note to the user (shown if declined)</label><input name="note" value="${esc(u.note || "")}"></div>
      <div class="modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, { size: "narrow" });
  const help = () => { $("#rh", m).textContent = ROLE_HELP[$("[name=role]", m).value]; };
  $("[name=role]", m).onchange = help; help();
  $("[data-x]", m).onclick = () => m.close();
  $("#uf", m).onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    busy(e.submitter, async () => { await setUserAccess(u.id, v); m.close(); }, "Saved.").catch(() => {});
  };
}

export function settingsPage(main) {
  const s = settings(), sg = s.signatories;
  const f = (name, label, value, type = "text") => `<div><label>${esc(label)}</label><input type="${type}" name="${name}" value="${esc(value)}"></div>`;
  main.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>Used on printed forms and as defaults when encoding.</p></div></div>
    <form id="sf" class="card grid g2">
      <fieldset class="spanall"><legend>Entity</legend><div class="grid g2">${f("entityName", "Entity name", s.entityName)}${f("address", "Address", s.address)}</div></fieldset>
      <fieldset class="spanall"><legend>Offices / departments</legend><label>One per line — offered when End-Users register and encode AIRs</label><textarea name="offices" rows="8">${esc(s.offices.join("\n"))}</textarea></fieldset>
      <fieldset class="spanall"><legend>Thresholds</legend><div class="grid g2">
        ${f("capitalization", "Capitalization threshold — unit cost at or above this is PPE (₱)", s.thresholds.capitalization, "number")}
        ${f("sxHighValue", "Semi-Expendable high-value threshold — above this is SPHV, else SPLV (₱)", s.thresholds.sxHighValue, "number")}</div></fieldset>
      <fieldset class="spanall"><legend>Default signatories</legend><div class="grid g2">
        ${f("propertyCustodian", "Supply and/or Property Custodian", sg.propertyCustodian)}${f("propertyCustodianPosition", "Position", sg.propertyCustodianPosition)}
        ${f("inspector", "Inspection Officer / Committee", sg.inspector)}${f("inspectorPosition", "Position", sg.inspectorPosition)}
        ${f("approver", "RIS approved by", sg.approver)}${f("approverPosition", "Position", sg.approverPosition)}
        ${f("accountant", "Accounting (RSMI posted by)", sg.accountant)}${f("accountantPosition", "Position", sg.accountantPosition)}</div></fieldset>
      <div class="spanall btn-row end"><button class="btn primary" type="submit">Save settings</button></div></form>`;
  $("#sf", main).onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    const cap = Number(v.capitalization), hv = Number(v.sxHighValue);
    if (!(cap > 0) || !(hv > 0) || hv >= cap) return toast("Thresholds must be positive, and the high-value threshold lower than the capitalization threshold.", "err");
    busy(e.submitter, async () => {
      await saveSettings({
        entityName: v.entityName.trim(), address: v.address.trim(),
        offices: [...new Set(v.offices.split("\n").map(x => x.trim()).filter(Boolean))],
        thresholds: { capitalization: cap, sxHighValue: hv },
        signatories: Object.fromEntries(Object.keys(sg).map(k => [k, String(v[k] || "").trim()]))
      });
      window.dispatchEvent(new Event("app:clean"));
    }, "Settings saved.").catch(() => {});
  };
}
settingsPage.deps = [];

export function audit(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Audit Trail</h1><p>The latest 300 actions. Entries can't be edited or deleted.</p></div></div><div class="card" id="t"></div>`;
  renderTable($("#t", main), {
    id: "audit", rows: S.d.audit, pageSize: 50,
    searchText: a => `${a.by} ${a.email} ${a.action} ${a.targetType} ${a.targetId} ${JSON.stringify(a.details || {})}`,
    columns: [
      { label: "When", render: a => `<span class="nowrap">${fmtDateTime(a.at)}</span>` },
      { label: "Who", render: a => `${esc(a.by)}<div class="xs muted">${esc(a.email)}</div>` },
      { label: "Action", render: a => esc(String(a.action).replace(/_/g, " ")) },
      { label: "Record", render: a => a.targetType === "air" ? `<a href="#/airs/${esc(a.targetId)}">AIR</a>` : a.targetType === "issuance" ? `<a href="#/issuances/${esc(a.targetId)}">Document</a>` : esc(a.targetType) },
      { label: "Details", render: a => `<span class="xs">${esc(Object.entries(a.details || {}).map(([k, v]) => `${k}: ${v}`).join(" · "))}</span>` }
    ],
    empty: "No activity yet."
  });
}
audit.deps = ["r:audit"];

export function profile(main) {
  const a = S.account || {};
  const pw = auth.currentUser?.providerData?.some(p => p.providerId === "password");
  main.innerHTML = `<div class="page-head"><div><h1>My Profile</h1><p>${esc(a.email)} · ${esc(ROLE_NAMES[a.role] || "")}</p></div></div>
    <form id="pf" class="card grid g2">
      <div><label class="req">Full name</label><input name="displayName" value="${esc(a.displayName)}"></div>
      <div><label class="req">Office / department</label><input name="office" list="ofl" value="${esc(a.office)}"><datalist id="ofl">${settings().offices.map(o => `<option value="${esc(o)}">`).join("")}</datalist></div>
      <div><label>Position / designation</label><input name="position" value="${esc(a.position)}"></div>
      <div><label>Contact number</label><input name="contact" value="${esc(a.contact || "")}"></div>
      <div class="spanall btn-row end"><button class="btn primary" type="submit">Save profile</button></div></form>
    ${pw ? `<form id="cp" class="card grid g3"><h3 class="spanall" style="margin:0">Change password</h3>
      <div><label>Current password</label><input type="password" name="cur" autocomplete="current-password"></div>
      <div><label>New password</label><input type="password" name="n1" autocomplete="new-password"></div>
      <div><label>Confirm new password</label><input type="password" name="n2" autocomplete="new-password"></div>
      <div class="spanall btn-row end"><button class="btn" type="submit">Change password</button></div></form>` : `<p class="small muted">You sign in with Google, so your password is managed by your Google account.</p>`}`;
  $("#pf", main).onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    if (!v.displayName.trim() || !v.office.trim()) return toast("Enter your name and office.", "err");
    busy(e.submitter, async () => { await updateProfile(v); window.dispatchEvent(new Event("app:clean")); }, "Profile saved.").catch(() => {});
  };
  $("#cp", main) && ($("#cp", main).onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    if (v.n1.length < 8) return toast("Use a new password of at least 8 characters.", "err");
    if (v.n1 !== v.n2) return toast("The new passwords do not match.", "err");
    busy(e.submitter, async () => {
      try {
        const u = auth.currentUser;
        await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, v.cur));
        await updatePassword(u, v.n1);
        e.target.reset(); window.dispatchEvent(new Event("app:clean"));
      } catch (err) { throw new Error(authError(err)); }
    }, "Password changed.").catch(() => {});
  });
}
profile.deps = ["account"];
