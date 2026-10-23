// Bringing the PMS users over: reads the PMS backup (firestore-export.json → user_roles), a Firebase Authentication
// export (firebase auth:export) or a pasted list, and proposes a PMS-IMS role for each person. Pure functions only.
import { SUPERADMIN_EMAILS } from "./catalog.js";

export const IMPORT_ROLES = ["enduser", "gso", "accounting", "admin"];
const EDIT = v => v === "edit";
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** PMS access → PMS-IMS role: Admin stays Admin; edit rights on the register, depreciation, reconciliation, CIP or SWA
 *  are Accounting's work here; edit rights on PAR / ICS, PTR / ITR or History of Repair only are the GSO's; anyone else
 *  (view-only) starts as End-User. The administrator can change any of them before importing. */
export function suggestRole(r) {
  if (r.is_admin) return "admin";
  const t = r.tabs || {};
  if (["register", "depreciation", "reconciliation", "cip", "swa", "retired"].some(k => EDIT(t[k]))) return "accounting";
  if (["parics", "ptritr", "hor"].some(k => EDIT(t[k]))) return "gso";
  return "enduser";
}
const describe = r => {
  if (r.is_admin) return "PMS Admin";
  const e = Object.entries(r.tabs || {}).filter(([, v]) => EDIT(v)).map(([k]) => k);
  return e.length ? `Edits: ${e.join(", ")}` : r.tabs ? "View only" : "";
};

function fromRoleDoc(r) {
  const email = String(r.email || r.id || "").trim().toLowerCase();
  const pending = r.pending === true || r.approved === false;
  return { email, name: String(r.display_name || r.displayName || r.name || "").trim(), pmsAccess: describe(r), role: suggestRole(r),
    include: !pending && r.active !== false, note: pending ? "Pending in PMS (never approved)" : r.active === false ? "Inactive in PMS" : "" };
}
function fromAuthUser(u) {
  return { email: String(u.email || "").trim().toLowerCase(), name: String(u.displayName || "").trim(), pmsAccess: "", role: "enduser", include: !u.disabled, note: u.disabled ? "Disabled in PMS" : "" };
}
function fromCsv(text) {
  const rows = String(text).split(/\r?\n/).map(l => l.split(/\t|,/).map(c => c.trim().replace(/^"|"$/g, ""))).filter(c => c[0]);
  return rows.filter(c => emailOk(c[0].toLowerCase())).map(([email, name = "", role = "", office = "", position = ""]) => ({
    email: email.toLowerCase(), name, office, position, pmsAccess: "", role: IMPORT_ROLES.includes(role.toLowerCase()) ? role.toLowerCase() : "enduser", include: true, note: "" }));
}

/**
 * Parses any number of sources and merges them by email (a later source fills what an earlier one left blank).
 * Accepts: the PMS backup JSON ({ user_roles: [...] } or the whole firestore-export.json), a bare user_roles array or
 * { email: doc } map, a Firebase Authentication export ({ users: [...] }), or text lines "email, name, role, office, position".
 */
export function parsePmsUsers(sources) {
  const byEmail = new Map(), errors = [];
  const add = row => {
    if (!emailOk(row.email)) return;
    if (SUPERADMIN_EMAILS.includes(row.email)) return; // the Super Administrator claims access by signing in
    const cur = byEmail.get(row.email);
    if (!cur) return byEmail.set(row.email, { office: "", position: "", ...row });
    for (const k of ["name", "office", "position", "pmsAccess", "note"]) if (!cur[k] && row[k]) cur[k] = row[k];
    if (row.pmsAccess) { cur.role = row.role; cur.include = row.include; }
  };
  for (const src of [].concat(sources || [])) {
    let data = src;
    if (typeof src === "string") {
      const t = src.trim();
      if (!t) continue;
      if (/^[[{]/.test(t)) { try { data = JSON.parse(t); } catch { errors.push("A file looks like JSON but could not be read."); continue; } }
      else { fromCsv(t).forEach(add); continue; }
    }
    if (Array.isArray(data?.users)) data.users.forEach(u => add(fromAuthUser(u)));
    const roles = data?.user_roles ?? (Array.isArray(data) ? data : null);
    if (Array.isArray(roles)) roles.forEach(r => add(fromRoleDoc(r)));
    else if (roles && typeof roles === "object") Object.entries(roles).forEach(([id, r]) => add(fromRoleDoc({ id, ...r })));
    else if (!Array.isArray(data?.users) && data && typeof data === "object" && !Array.isArray(data))
      Object.entries(data).filter(([k]) => emailOk(k)).forEach(([id, r]) => add(fromRoleDoc({ id, ...r })));
  }
  if (!byEmail.size && !errors.length) errors.push("No users found. Use the PMS backup (firestore-export.json), a Firebase Authentication export, or one email per line.");
  return { users: [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email)), errors };
}
