// Live application state: Firestore listeners chosen by role.
import { db, doc, collection, query, where, orderBy, limit, onSnapshot } from "./fb.js";
import { DEFAULT_THRESHOLDS } from "./core/catalog.js";

export const S = {
  user: null, account: undefined, settings: null,
  fund: readFund(), d: { airs: [], docs: [], users: [], audit: [] }, ready: new Set()
};
function readFund() { try { return localStorage.getItem("pmsims.fund") || "GF"; } catch { return "GF"; } }
export function setFund(f) { S.fund = f; try { localStorage.setItem("pmsims.fund", f); } catch { /* private mode */ } emit("fund"); }

const subs = new Map();      // key -> unsubscribe
const watchers = new Set();  // (key) => void

export function onChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }
function emit(key) { S.ready.add(key); watchers.forEach(fn => { try { fn(key); } catch (e) { console.error(e); } }); }

const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

/** Live listener. `confirmed` skips local, not-yet-saved snapshots (used for the account record, so
 *  role-based listeners only start once the server has the record the security rules will check).
 *  A refused listener is retried a few times: access can arrive a moment after a role change. */
function live(key, target, map, { confirmed = false, attempt = 0 } = {}) {
  if (subs.has(key)) return;
  const isDoc = target.type === "document";
  subs.set(key, onSnapshot(target, snap => {
    if (confirmed && snap.metadata.hasPendingWrites) return;
    map(isDoc ? (snap.exists() ? { id: snap.id, ...snap.data() } : null) : rows(snap));
    emit(key);
  }, err => {
    console.warn(`listener ${key}:`, err.code || err.message);
    subs.delete(key);
    map(isDoc ? null : []); emit(key);
    if (err.code === "permission-denied" && attempt < 4) {
      const t = setTimeout(() => { retries.delete(key); live(key, target, map, { confirmed, attempt: attempt + 1 }); }, 1500 * (attempt + 1));
      retries.set(key, t);
    }
  }));
}
const retries = new Map();
export function stop(prefix = "") {
  for (const [k, u] of subs) if (!prefix || k.startsWith(prefix)) { u(); subs.delete(k); S.ready.delete(k); }
  for (const [k, t] of retries) if (!prefix || k.startsWith(prefix)) { clearTimeout(t); retries.delete(k); }
}

/** The signed-in user's own account record. */
export function startAccount(uid) {
  live("account", doc(db, "users", uid), v => { S.account = v; }, { confirmed: true });
  live("settings", doc(db, "settings", "app"), v => { S.settings = v || {}; });
}

/** Listeners that depend on the role on the account record (the security rules enforce the same split). */
export function startRole() {
  stop("r:");
  const uid = S.user.uid;
  if (role() === "enduser") {
    live("r:airs", query(collection(db, "airs"), where("endUserUid", "==", uid)), v => { S.d.airs = v; });
    live("r:docs", query(collection(db, "issuances"), where("endUserUid", "==", uid)), v => { S.d.docs = v; });
  } else {
    live("r:airs", collection(db, "airs"), v => { S.d.airs = v; });
    live("r:docs", collection(db, "issuances"), v => { S.d.docs = v; });
  }
  if (isAdmin()) {
    live("r:users", collection(db, "users"), v => { S.d.users = v; });
    live("r:audit", query(collection(db, "auditLogs"), orderBy("at", "desc"), limit(300)), v => { S.d.audit = v; });
  }
}

export const role = () => (S.account?.status === "active" ? S.account.role : "") || "";
export const isSuper = () => role() === "superadmin";
export const isAdmin = () => ["admin", "superadmin"].includes(role());

/** What each role may do. Mirrors firestore.rules — the rules are what actually enforces it. */
const PERMS = {
  encodeAir: ["enduser", "admin", "superadmin"],
  inspectAir: ["gso", "admin", "superadmin"],
  issue: ["gso", "admin", "superadmin"],
  post: ["accounting", "admin", "superadmin"],
  viewAll: ["gso", "accounting", "admin", "superadmin"],
  manageUsers: ["admin", "superadmin"]
};
export const can = perm => (PERMS[perm] || []).includes(role());

export function settings() {
  const s = S.settings || {};
  return {
    entityName: s.entityName || "Municipal Government of Candoni",
    address: s.address || "Municipal Building, Rizal St., Candoni, Negros Occidental, 6110",
    offices: s.offices || [],
    thresholds: { ...DEFAULT_THRESHOLDS, ...(s.thresholds || {}) },
    signatories: {
      propertyCustodian: "", propertyCustodianPosition: "Supply and/or Property Custodian",
      inspector: "", inspectorPosition: "Inspection Officer/Inspection Committee",
      accountant: "", accountantPosition: "Municipal Accountant",
      approver: "", approverPosition: "Municipal Mayor",
      ...(s.signatories || {})
    }
  };
}

export const fundAirs = () => S.d.airs.filter(a => a.fund === S.fund);
export const fundDocs = () => S.d.docs.filter(d => d.fund === S.fund);
export const airById = id => S.d.airs.find(a => a.id === id) || null;
export const docById = id => S.d.docs.find(d => d.id === id) || null;
export const docsOfAir = id => S.d.docs.filter(d => d.airId === id);
