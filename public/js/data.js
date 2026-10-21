// Every write the app makes. Multi-document changes run in Firestore transactions so numbering and
// issued quantities stay exact even when several people work at the same time.
import {
  db, doc, collection, setDoc, updateDoc, deleteDoc, addDoc, runTransaction, serverTimestamp, arrayUnion, dbError
} from "./fb.js";
import { S, settings } from "./state.js";
import { SUPERADMIN_EMAILS, DOC_TYPES } from "./core/catalog.js";
import {
  round2, lineAmount, linesTotal, counterKey, formatNumber, validateAir, validateInspection, checkIssue, sxClass,
  statusAfterIssue, remainingQty
} from "./core/logic.js";

const me = () => ({ uid: S.user.uid, name: S.account?.displayName || S.user.displayName || S.user.email, email: S.user.email });
const stamp = (action, note = "") => ({ at: new Date().toISOString(), uid: S.user.uid, by: me().name, action, ...(note ? { note } : {}) });
const wrap = async fn => { try { return await fn(); } catch (e) { throw new Error(e.userMessage || dbError(e)); } };
const fail = msg => { const e = new Error(msg); e.userMessage = msg; return e; };

export function audit(action, targetType, targetId, details = {}) {
  return addDoc(collection(db, "auditLogs"), { at: serverTimestamp(), uid: S.user.uid, by: me().name, email: S.user.email, action, targetType, targetId, details })
    .catch(e => console.warn("audit:", e.code || e.message));
}

/** Reads and advances a counter inside a transaction. Reads must happen before any write. */
async function readCounter(tx, fund, type, date, cls) {
  const { key, ym, prefix } = counterKey(fund, type, date, cls);
  const ref = doc(db, "counters", key);
  const snap = await tx.get(ref);
  const seq = (snap.exists() ? snap.data().seq || 0 : 0) + 1;
  return { ref, seq, number: formatNumber(type, ym, prefix, seq) };
}

/* ---------------- AIR (end-user) ---------------- */
function cleanLines(lines) {
  return (lines || []).map(l => ({
    id: l.id, description: String(l.description || "").trim(), specs: String(l.specs || "").trim(), unit: String(l.unit || "").trim(),
    qty: round2(l.qty), unitCost: round2(l.unitCost), amount: lineAmount(l), kind: l.kind === "supplies" ? "supplies" : "equipment",
    category: l.category || "", accountCode: l.accountCode || "", stockNo: String(l.stockNo || "").trim().toUpperCase(),
    propertyNo: String(l.propertyNo || "").trim(), usefulLife: String(l.usefulLife || "").trim(), issuedQty: 0
  }));
}
function airFields(a) {
  return {
    fund: a.fund, date: a.date, office: String(a.office || "").trim(), supplier: String(a.supplier || "").trim(),
    poNo: String(a.poNo || "").trim(), poDate: a.poDate || "", invNo: String(a.invNo || "").trim(), invDate: a.invDate || "",
    purpose: String(a.purpose || "").trim(), lines: cleanLines(a.lines), total: linesTotal(a.lines)
  };
}

/** Saves an AIR as a draft, or submits it to the GSO (the AIR number is assigned on first submission). */
export function saveAir(id, form, submit) {
  return wrap(async () => {
    const fields = airFields(form);
    if (submit) { const errs = validateAir(fields); if (errs.length) throw fail(errs[0]); }
    const ref = id ? doc(db, "airs", id) : doc(collection(db, "airs"));
    await runTransaction(db, async tx => {
      const cur = id ? await tx.get(ref) : null;
      if (id && !cur.exists()) throw fail("This AIR no longer exists.");
      const old = cur?.data();
      if (old && !["draft", "returned"].includes(old.status)) throw fail("This AIR was already submitted and can no longer be edited.");
      let airNo = old?.airNo || "";
      const counter = submit && !airNo ? await readCounter(tx, fields.fund, "air", fields.date) : null;
      if (counter) { airNo = counter.number; tx.set(counter.ref, { seq: counter.seq, updatedAt: serverTimestamp() }); }
      const history = [...(old?.history || []), stamp(submit ? (old?.status === "returned" ? "Resubmitted to GSO" : "Submitted to GSO") : "Saved as draft")];
      const data = { ...fields, airNo, status: submit ? "submitted" : "draft", history, updatedAt: serverTimestamp(), ...(submit ? { submittedAt: serverTimestamp() } : {}) };
      if (old) tx.update(ref, data);
      else tx.set(ref, { ...data, endUserUid: S.user.uid, endUserName: me().name, endUserEmail: S.user.email, createdAt: serverTimestamp() });
    });
    if (submit) audit("air_submit", "air", ref.id, { fund: fields.fund, total: fields.total });
    return ref.id;
  });
}
export const deleteAir = id => wrap(() => deleteDoc(doc(db, "airs", id)));

/* ---------------- AIR (GSO inspection) ---------------- */
export function returnAir(id, remarks) {
  return wrap(async () => {
    await runTransaction(db, async tx => {
      const ref = doc(db, "airs", id); const cur = await tx.get(ref);
      if (cur.data()?.status !== "submitted") throw fail("Only an AIR waiting for inspection can be returned.");
      tx.update(ref, { status: "returned", gsoRemarks: remarks, history: [...(cur.data().history || []), stamp("Returned to end-user", remarks)], updatedAt: serverTimestamp() });
    });
    audit("air_return", "air", id, { remarks });
  });
}

/** Records the inspection and acceptance, the GSO's classification of each line, and approves the AIR. */
export function approveAir(id, insp) {
  return wrap(async () => {
    await runTransaction(db, async tx => {
      const ref = doc(db, "airs", id); const cur = await tx.get(ref);
      const old = cur.data();
      if (old?.status !== "submitted") throw fail("Only an AIR waiting for inspection can be approved.");
      const lines = old.lines.map(l => {
        const c = insp.lines.find(x => x.id === l.id) || {};
        return { ...l, category: c.category, accountCode: c.accountCode, stockNo: String(c.stockNo || "").trim().toUpperCase(),
          propertyNo: String(c.propertyNo || "").trim(), usefulLife: String(c.usefulLife || "").trim(), issuedQty: 0 };
      });
      const next = { ...old, lines, inspection: insp.inspection, acceptance: insp.acceptance };
      const errs = validateInspection(next);
      if (errs.length) throw fail(errs[0]);
      tx.update(ref, { lines, inspection: insp.inspection, acceptance: insp.acceptance, gsoRemarks: insp.remarks || "", status: "approved",
        approvedBy: me(), approvedAt: serverTimestamp(), history: [...(old.history || []), stamp("Inspected and approved by GSO", insp.remarks || "")], updatedAt: serverTimestamp() });
    });
    audit("air_approve", "air", id, {});
  });
}

/* ---------------- PAR / ICS / RIS (GSO issuance) ---------------- */
/**
 * Issues documents from an approved AIR. ICS lines are split by value class (SPLV / SPHV numbering).
 * header: { date, recipient:{uid,name,position,office}, issuedBy:{name,position}, purpose, approvedBy:{name,position}, lineInfo:{[lineId]:{propertyNo,usefulLife}} }
 * Returns the issued document numbers.
 */
export function issueDocs(airId, docType, picks, header) {
  return wrap(async () => {
    if (!header.date) throw fail("Enter the date issued.");
    if (!String(header.recipient?.name || "").trim()) throw fail(docType === "ris" ? "Enter who requested / received the items." : "Enter the end-user receiving the property.");
    const th = settings().thresholds;
    const issued = [];
    await runTransaction(db, async tx => {
      const airRef = doc(db, "airs", airId); const snap = await tx.get(airRef);
      if (!snap.exists()) throw fail("This AIR no longer exists.");
      const air = { id: airId, ...snap.data() };
      const { errors, lines } = checkIssue(air, docType, picks);
      if (errors.length) throw fail(errors[0]);
      const groups = new Map();
      for (const l of lines) { const k = docType === "ics" ? sxClass(l.unitCost, th) : ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
      const counters = [];
      for (const k of groups.keys()) counters.push(await readCounter(tx, air.fund, docType, header.date, k));
      [...groups.entries()].forEach(([cls, gl], i) => {
        const c = counters[i];
        tx.set(c.ref, { seq: c.seq, updatedAt: serverTimestamp() });
        const docLines = gl.map(l => {
          const info = header.lineInfo?.[l.id] || {};
          return { airLineId: l.id, description: l.description, specs: l.specs || "", unit: l.unit, qty: l.issueQty, unitCost: l.unitCost,
            amount: round2(l.issueQty * l.unitCost), accountCode: l.accountCode, stockNo: l.stockNo || "",
            propertyNo: String(info.propertyNo ?? l.propertyNo ?? "").trim(), usefulLife: String(info.usefulLife ?? l.usefulLife ?? "").trim(), qtyRequested: Number(info.qtyRequested) || l.issueQty };
        });
        const ref = doc(collection(db, "issuances"));
        tx.set(ref, {
          docType, number: c.number, fund: air.fund, date: header.date, sxClass: cls || null,
          airId, airNo: air.airNo, endUserUid: air.endUserUid, office: air.office, supplier: air.supplier,
          recipient: header.recipient, issuedBy: header.issuedBy || {}, approvedBy: header.approvedBy || {}, purpose: header.purpose || "",
          lines: docLines, total: linesTotal(docLines), status: "issued",
          posting: { posted: false }, createdBy: me(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        issued.push({ id: ref.id, number: c.number });
      });
      const newLines = air.lines.map(l => { const p = lines.find(x => x.id === l.id); return p ? { ...l, issuedQty: round2((Number(l.issuedQty) || 0) + p.issueQty) } : l; });
      tx.update(airRef, { lines: newLines, status: statusAfterIssue(newLines),
        history: [...(air.history || []), stamp(`${DOC_TYPES[docType].short} ${issued.map(x => x.number).join(", ")} issued`)], updatedAt: serverTimestamp() });
    });
    issued.forEach(x => audit(`${docType}_issue`, "issuance", x.id, { number: x.number, airId }));
    return issued;
  });
}

/** Cancels an unposted PAR/ICS/RIS and returns its quantities to the AIR so they can be issued again. */
export function cancelDoc(docId, reason) {
  return wrap(async () => {
    await runTransaction(db, async tx => {
      const ref = doc(db, "issuances", docId); const snap = await tx.get(ref);
      const d = snap.data();
      if (!d || d.status === "cancelled") throw fail("This document is already cancelled.");
      if (d.posting?.posted) throw fail("Accounting has already posted this document. Ask Accounting to unpost it first.");
      const airRef = doc(db, "airs", d.airId); const airSnap = await tx.get(airRef);
      const air = airSnap.data();
      const lines = air.lines.map(l => { const back = d.lines.filter(x => x.airLineId === l.id).reduce((t, x) => t + x.qty, 0); return back ? { ...l, issuedQty: Math.max(0, round2((Number(l.issuedQty) || 0) - back)) } : l; });
      tx.update(ref, { status: "cancelled", cancel: { reason, by: me(), at: new Date().toISOString() }, updatedAt: serverTimestamp() });
      tx.update(airRef, { lines, status: statusAfterIssue(lines), history: [...(air.history || []), stamp(`${DOC_TYPES[d.docType].short} ${d.number} cancelled`, reason)], updatedAt: serverTimestamp() });
    });
    audit("issuance_cancel", "issuance", docId, { reason });
  });
}

/* ---------------- Accounting posting ---------------- */
/** kind: "air" (the receipt of supplies) or "doc" (a PAR / ICS / RIS). */
export function setPosting(kind, id, posting) {
  return wrap(async () => {
    const coll = kind === "air" ? "airs" : "issuances";
    const data = posting
      ? { posted: true, date: posting.date, ref: String(posting.ref || "").trim(), remarks: String(posting.remarks || "").trim(), by: me(), at: new Date().toISOString() }
      : { posted: false, unpostedBy: me(), unpostedAt: new Date().toISOString() };
    if (posting && !posting.date) throw fail("Enter the posting date.");
    if (posting && !data.ref) throw fail("Enter the JEV / reference number.");
    const patch = { posting: data, updatedAt: serverTimestamp() };
    if (kind === "air") patch.history = arrayUnion(stamp(posting ? "Receipt posted by Accounting" : "Receipt unposted by Accounting", posting ? data.ref : ""));
    await updateDoc(doc(db, coll, id), patch);
    audit(posting ? "post" : "unpost", kind === "air" ? "air" : "issuance", id, posting ? { ref: data.ref, date: data.date } : {});
  });
}

/* ---------------- Accounts and settings ---------------- */
export const isBootstrapEmail = email => SUPERADMIN_EMAILS.includes(String(email || "").toLowerCase());

export function register(data) {
  return wrap(() => setDoc(doc(db, "users", S.user.uid), {
    uid: S.user.uid, email: S.user.email, displayName: String(data.displayName || "").trim(), office: String(data.office || "").trim(),
    position: String(data.position || "").trim(), contact: String(data.contact || "").trim(), photoURL: S.user.photoURL || "",
    role: "enduser", status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
}
export function claimSuperadmin(data) {
  return wrap(() => setDoc(doc(db, "users", S.user.uid), {
    uid: S.user.uid, email: S.user.email, displayName: String(data.displayName || S.user.displayName || S.user.email).trim(),
    office: String(data.office || "Accounting Office").trim(), position: String(data.position || "").trim(), contact: "", photoURL: S.user.photoURL || "",
    role: "superadmin", status: "active", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
}
export function updateProfile(data) {
  return wrap(() => updateDoc(doc(db, "users", S.user.uid), {
    displayName: String(data.displayName || "").trim(), office: String(data.office || "").trim(), position: String(data.position || "").trim(),
    contact: String(data.contact || "").trim(), updatedAt: serverTimestamp()
  }));
}
export function setUserAccess(uid, { role, status, note = "" }) {
  return wrap(async () => {
    await updateDoc(doc(db, "users", uid), { role, status, note, reviewedBy: me(), reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    audit("user_access", "user", uid, { role, status });
  });
}
export function saveSettings(patch) {
  return wrap(async () => {
    await setDoc(doc(db, "settings", "app"), { ...patch, updatedAt: serverTimestamp(), updatedBy: me() }, { merge: true });
    audit("settings_update", "settings", "app", {});
  });
}

export { remainingQty };
