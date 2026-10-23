// Live application state: Firestore listeners chosen by role.
import { db, doc, collection, query, where, orderBy, limit, onSnapshot } from "./fb.js";
import { DEFAULT_THRESHOLDS, DEFAULT_OFFICES } from "./core/catalog.js";

export const S = {
  user: null, account: undefined, settings: null,
  fund: readFund(), d: emptyData(), ready: new Set()
};
export function emptyData() { return { airs: [], docs: [], users: [], audit: [], invites: [], items: [], attachments: [], assets: [], movements: [], depr: [], tb: [], cip: [], swa: [], repairs: [] }; }
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
/** AIRs a colleague in the same office may see — never someone else's draft. Must match firestore.rules. */
const OFFICE_AIR_STATUSES = ["submitted", "returned", "approved", "issued"];
export function startRole() {
  stop("r:");
  const uid = S.user.uid;
  live("r:items", collection(db, "items"), v => { S.d.items = v; });
  if (role() === "enduser") {
    // their own records (drafts included), plus everything of their office: submitted AIRs, documents issued and property held
    const office = S.account?.office || "";
    const parts = { airs: [[], []], docs: [[], []], assets: [[], []] };
    const merge = (key, i, v) => { parts[key][i] = v; const seen = new Map(); parts[key].flat().forEach(x => seen.set(x.id, x)); S.d[key] = [...seen.values()]; };
    live("r:airs", query(collection(db, "airs"), where("endUserUid", "==", uid)), v => merge("airs", 0, v));
    live("r:docs", query(collection(db, "issuances"), where("endUserUid", "==", uid)), v => merge("docs", 0, v));
    live("r:assets", query(collection(db, "assets"), where("custodianUid", "==", uid)), v => merge("assets", 0, v));
    if (office) {
      live("r:officeAirs", query(collection(db, "airs"), where("office", "==", office), where("status", "in", OFFICE_AIR_STATUSES)), v => merge("airs", 1, v));
      live("r:officeDocs", query(collection(db, "issuances"), where("recipient.office", "==", office)), v => merge("docs", 1, v));
      live("r:officeAssets", query(collection(db, "assets"), where("holder.office", "==", office)), v => merge("assets", 1, v));
    }
    live("r:repairs", query(collection(db, "repairs"), where("endUserUid", "==", uid)), v => { S.d.repairs = v; });
    if (office) live("r:attachments", query(collection(db, "attachments"), where("office", "==", office)), v => { S.d.attachments = v; });
  } else {
    live("r:airs", collection(db, "airs"), v => { S.d.airs = v; });
    live("r:docs", collection(db, "issuances"), v => { S.d.docs = v; });
    live("r:assets", collection(db, "assets"), v => { S.d.assets = v; });
    live("r:movements", collection(db, "movements"), v => { S.d.movements = v; });
    live("r:depr", collection(db, "depreciation"), v => { S.d.depr = v; });
    live("r:tb", collection(db, "tbSnapshots"), v => { S.d.tb = v; });
    live("r:cip", collection(db, "cipProjects"), v => { S.d.cip = v; });
    live("r:swa", collection(db, "swa"), v => { S.d.swa = v; });
    live("r:repairs", collection(db, "repairs"), v => { S.d.repairs = v; });
    live("r:users", collection(db, "users"), v => { S.d.users = v; });
    live("r:attachments", collection(db, "attachments"), v => { S.d.attachments = v; });
  }
  if (isAdmin()) {
    live("r:audit", query(collection(db, "auditLogs"), orderBy("at", "desc"), limit(300)), v => { S.d.audit = v; });
    live("r:invites", collection(db, "invites"), v => { S.d.invites = v; });
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
  manageUsers: ["admin", "superadmin"],
  manageCip: ["accounting", "admin", "superadmin"],
  encodeSwa: ["gso", "accounting", "admin", "superadmin"]
};
export const can = perm => (PERMS[perm] || []).includes(role());

export function settings() {
  const s = S.settings || {};
  return {
    entityName: s.entityName || "Municipal Government of Candoni",
    address: s.address || "Municipal Building, Rizal St., Candoni, Negros Occidental, 6110",
    offices: s.offices?.length ? s.offices : DEFAULT_OFFICES,
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
export const fundAssets = () => S.d.assets.filter(a => a.fund === S.fund);
export const assetById = id => S.d.assets.find(a => a.id === id) || null;
export const fundRuns = () => S.d.depr.filter(r => r.fund === S.fund);
/** Active users for the "received by" pickers. */
export const activeUsers = () => S.d.users.filter(u => u.status === "active").sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
