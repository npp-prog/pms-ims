// Every write the app makes. Multi-document changes run in Firestore transactions so numbering and
// issued quantities stay exact even when several people work at the same time.
import {
  db, doc, collection, setDoc, updateDoc, deleteDoc, addDoc, runTransaction, serverTimestamp, arrayUnion, dbError
} from "./fb.js";
import { S, settings } from "./state.js";
import { SUPERADMIN_EMAILS, DOC_TYPES, ppeAccount } from "./core/catalog.js";
import { residualFor, defaultLife, checkMovement, movementDocType, isDepreciable } from "./core/assets.js";
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
        const ref = doc(collection(db, "issuances"));
        const docLines = gl.map(l => {
          const info = header.lineInfo?.[l.id] || {};
          const assetRef = docType === "ris" ? null : doc(collection(db, "assets"));
          return { ...(assetRef ? { assetId: assetRef.id, assetRef } : {}), airLineId: l.id, description: l.description, specs: l.specs || "", unit: l.unit, qty: l.issueQty, unitCost: l.unitCost,
            amount: round2(l.issueQty * l.unitCost), accountCode: l.accountCode, stockNo: l.stockNo || "",
            propertyNo: String(info.propertyNo ?? l.propertyNo ?? "").trim(), usefulLife: String(info.usefulLife ?? l.usefulLife ?? "").trim(), qtyRequested: Number(info.qtyRequested) || l.issueQty };
        });
        // PAR / ICS lines become property records (one per line) in the same transaction.
        for (const dl of docLines) {
          if (!dl.assetRef) continue;
          const ppe = docType === "par", amount = dl.amount;
          const life = ppe ? (Number(String(dl.usefulLife).replace(/[^\d.]/g, "")) || defaultLife(dl.accountCode)) : 0;
          tx.set(dl.assetRef, {
            fund: air.fund, itemType: ppe ? "ppe" : "sx", accountCode: dl.accountCode, propertyNo: dl.propertyNo, description: dl.description, specs: dl.specs,
            unit: dl.unit, qty: dl.qty, unitCost: dl.unitCost, cost: amount, residualValue: ppe ? residualFor(dl.accountCode, amount) : 0,
            usefulLifeYears: life, estimatedLife: ppe ? "" : dl.usefulLife, depreciable: ppe && !!ppeAccount(dl.accountCode)?.depreciable && life > 0,
            dateAcquired: air.acceptance?.dateReceived || header.date,
            holder: { name: header.recipient.name, position: header.recipient.position || "", office: header.recipient.office || "" },
            custodianUid: header.recipient.uid || "", location: header.recipient.office || "", status: "active", condition: "Serviceable",
            source: { kind: docType, docId: ref.id, number: c.number, airId, airNo: air.airNo }, depBaseline: null, disposal: null,
            history: [stamp(`${docType.toUpperCase()} ${c.number} issued to ${header.recipient.name}`)], createdAt: serverTimestamp(), updatedAt: serverTimestamp()
          });
          delete dl.assetRef;
        }
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
      const assetRefs = d.lines.filter(l => l.assetId).map(l => doc(db, "assets", l.assetId));
      const assets = [];
      for (const r of assetRefs) assets.push(await tx.get(r));
      if (assets.some(x => x.exists() && (x.data().status !== "active" || (x.data().history || []).length > 1)))
        throw fail("Some of this property was already transferred, returned or disposed. Reverse those first.");
      const lines = air.lines.map(l => { const back = d.lines.filter(x => x.airLineId === l.id).reduce((t, x) => t + x.qty, 0); return back ? { ...l, issuedQty: Math.max(0, round2((Number(l.issuedQty) || 0) - back)) } : l; });
      tx.update(ref, { status: "cancelled", cancel: { reason, by: me(), at: new Date().toISOString() }, updatedAt: serverTimestamp() });
      assets.forEach(x => { if (x.exists()) tx.update(x.ref, { status: "cancelled", history: [...(x.data().history || []), stamp(`${d.docType.toUpperCase()} ${d.number} cancelled`, reason)], updatedAt: serverTimestamp() }); });
      tx.update(airRef, { lines, status: statusAfterIssue(lines), history: [...(air.history || []), stamp(`${DOC_TYPES[d.docType].short} ${d.number} cancelled`, reason)], updatedAt: serverTimestamp() });
    });
    audit("issuance_cancel", "issuance", docId, { reason });
  });
}

/* ---------------- Accounting posting ---------------- */
/** kind: "air" (the receipt of supplies) or "doc" (a PAR / ICS / RIS). */
export function setPosting(kind, id, posting) {
  return wrap(async () => {
    const coll = kind === "air" ? "airs" : kind === "movement" ? "movements" : "issuances";
    const data = posting
      ? { posted: true, date: posting.date, ref: String(posting.ref || "").trim(), remarks: String(posting.remarks || "").trim(), by: me(), at: new Date().toISOString() }
      : { posted: false, unpostedBy: me(), unpostedAt: new Date().toISOString() };
    if (posting && !posting.date) throw fail("Enter the posting date.");
    if (posting && !data.ref) throw fail("Enter the JEV / reference number.");
    const patch = { posting: data, updatedAt: serverTimestamp() };
    if (kind === "air") patch.history = arrayUnion(stamp(posting ? "Receipt posted by Accounting" : "Receipt unposted by Accounting", posting ? data.ref : ""));
    await updateDoc(doc(db, coll, id), patch);
    audit(posting ? "post" : "unpost", kind === "air" ? "air" : kind === "movement" ? "movement" : "issuance", id, posting ? { ref: data.ref, date: data.date } : {});
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

/* ---------------- property movements: transfers, returns, disposals ---------------- */
/**
 * kind: "transfer" (PTR / ITR), "return" (PRS / RRSP) or "dispose".
 * h: { date, to:{name,position,office,uid}, location, transferType, typeOther, reason, mode, ref, approvedBy, issuedBy,
 *      lines: { [assetId]: { condition, qty, carrying } } }
 * Semi-expendable items may be moved in part (qty below what the record holds): the record is split.
 */
export function saveMovement(kind, assetIds, h) {
  return wrap(async () => {
    if (!h.date) throw fail("Enter the date.");
    if (kind === "transfer" && !String(h.to?.name || "").trim()) throw fail("Enter who receives the property.");
    if (kind === "transfer" && h.transferType === "others" && !String(h.typeOther || "").trim()) throw fail("Specify the transfer type.");
    if (kind === "dispose" && !h.mode) throw fail("Choose how the property was disposed of.");
    const sg = settings().signatories;
    let out = null;
    await runTransaction(db, async tx => {
      const snaps = [];
      for (const id of assetIds) snaps.push(await tx.get(doc(db, "assets", id)));
      if (snaps.some(x => !x.exists())) throw fail("An item no longer exists.");
      const assets = snaps.map(x => ({ id: x.id, ...x.data() }));
      const err = checkMovement(assets, kind === "dispose" ? "dispose" : kind); if (err) throw fail(err);
      const itemType = assets[0].itemType, docType = movementDocType(kind, itemType);
      const c = await readCounter(tx, assets[0].fund, docType, h.date);
      tx.set(c.ref, { seq: c.seq, updatedAt: serverTimestamp() });
      const mref = doc(collection(db, "movements"));
      const donation = kind === "transfer" && h.transferType === "donation";
      const custody = { name: sg.propertyCustodian || "GSO — Property Custodian", position: sg.propertyCustodianPosition, office: "General Services Office", uid: "" };
      const to = kind === "return" ? custody : kind === "transfer" ? { name: h.to.name.trim(), position: h.to.position || "", office: h.to.office || "", uid: h.to.uid || "" } : null;
      const label = `${docType.toUpperCase()} ${c.number}`;
      const lines = [];
      for (const a of assets) {
        const li = h.lines?.[a.id] || {};
        const q = Number(li.qty) || a.qty;
        const split = q < a.qty;
        if (split) {
          if (a.itemType === "ppe") throw fail(`${a.description}: PPE moves as a whole record.`);
          if (!(q > 0) || !Number.isInteger(q)) throw fail(`${a.description}: enter a whole quantity.`);
        }
        const cost = split ? round2(a.unitCost * q) : a.cost;
        const hist = [...(a.history || []), ...(split ? [stamp(`Split from item ${a.propertyNo || a.id} (${q} of ${a.qty})`)] : [])];
        const patch = { updatedAt: serverTimestamp() };
        if (kind === "dispose" || donation) {
          Object.assign(patch, { status: "disposed", disposal: { date: h.date, reason: donation ? "Donated out" : h.mode, ref: h.ref || label, movementId: mref.id } });
          hist.push(stamp(`${donation ? "Donated" : "Disposed"} — ${label}`, h.reason || h.mode || ""));
          if (donation) Object.assign(patch, { holder: { name: to.name, position: to.position, office: to.office }, custodianUid: "" });
        } else {
          Object.assign(patch, { holder: { name: to.name, position: to.position, office: to.office }, custodianUid: to.uid || "", location: h.location || to.office || a.location || "",
            status: kind === "return" ? "returned" : "active", condition: li.condition || a.condition || "Serviceable" });
          hist.push(stamp(`${kind === "return" ? "Returned to the GSO" : `Transferred to ${to.name}`} — ${label}`, h.reason || ""));
        }
        patch.history = hist;
        let targetId = a.id;
        if (split) {
          // the moved part becomes its own record; the rest stays where it is
          const nref = doc(collection(db, "assets")); targetId = nref.id;
          const rest = { ...a }; delete rest.id;
          tx.set(nref, { ...rest, qty: q, cost, ...patch, createdAt: serverTimestamp() });
          tx.update(doc(db, "assets", a.id), { qty: a.qty - q, cost: round2(a.cost - cost), history: [...(a.history || []), stamp(`${q} ${a.unit} moved out on ${label}`)], updatedAt: serverTimestamp() });
        } else tx.update(doc(db, "assets", a.id), patch);
        lines.push({ assetId: targetId, propertyNo: a.propertyNo || "", parIcsNo: a.source?.number || "", description: a.description, dateAcquired: a.dateAcquired || "",
          qty: q, unit: a.unit, amount: cost, accountCode: a.accountCode, condition: li.condition || a.condition || "Serviceable",
          carrying: round2(Number(li.carrying ?? cost) || 0), prevStatus: a.status, prevHolder: a.holder || {} });
      }
      const needsPosting = kind === "dispose" || donation;
      tx.set(mref, {
        docType, kind, number: c.number, fund: assets[0].fund, itemType, date: h.date,
        from: { name: assets[0].holder?.name || "", position: assets[0].holder?.position || "", office: assets[0].holder?.office || "" }, to,
        transferType: h.transferType || "", typeOther: h.typeOther || "", reason: h.reason || "", mode: h.mode || "", ref: h.ref || "", location: h.location || "",
        approvedBy: h.approvedBy || {}, issuedBy: h.issuedBy || {}, lines, total: round2(lines.reduce((t, l) => t + l.amount, 0)),
        carryingTotal: round2(lines.reduce((t, l) => t + l.carrying, 0)),
        status: "done", needsPosting, posting: { posted: false }, createdBy: me(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      out = { id: mref.id, number: c.number, docType };
    });
    audit(`${out.docType}_save`, "movement", out.id, { number: out.number, items: assetIds.length });
    return out;
  });
}

/** Cancels a disposal (or a donation) that Accounting has not posted: the items go back as they were. */
export function cancelMovement(id, reason) {
  return wrap(async () => {
    await runTransaction(db, async tx => {
      const ref = doc(db, "movements", id); const m = (await tx.get(ref)).data();
      if (!m || m.status === "cancelled") throw fail("Already cancelled.");
      if (!m.needsPosting) throw fail("Transfers and returns are corrected with a new transfer, not cancelled.");
      if (m.posting?.posted) throw fail("Accounting has already posted this. Ask Accounting to unpost it first.");
      const snaps = [];
      for (const l of m.lines) snaps.push(await tx.get(doc(db, "assets", l.assetId)));
      snaps.forEach((x, i) => {
        const l = m.lines[i], a = x.data();
        tx.update(x.ref, { status: l.prevStatus || "active", disposal: null, holder: l.prevHolder || a.holder, history: [...(a.history || []), stamp(`${m.docType.toUpperCase()} ${m.number} cancelled`, reason)], updatedAt: serverTimestamp() });
      });
      tx.update(ref, { status: "cancelled", cancel: { reason, by: me(), at: new Date().toISOString() }, updatedAt: serverTimestamp() });
    });
    audit("movement_cancel", "movement", id, { reason });
  });
}

/** Corrections to a property record (not its cost or fund). */
export function updateAsset(id, patch, note) {
  return wrap(async () => {
    await runTransaction(db, async tx => {
      const ref = doc(db, "assets", id); const a = (await tx.get(ref)).data();
      const clean = {};
      for (const k of ["propertyNo", "location", "usefulLifeYears", "residualValue", "condition", "estimatedLife", "description", "specs"]) if (k in patch) clean[k] = patch[k];
      if ("usefulLifeYears" in clean) clean.usefulLifeYears = Number(clean.usefulLifeYears) || 0;
      if ("residualValue" in clean) clean.residualValue = round2(clean.residualValue);
      if (a.itemType === "ppe") clean.depreciable = isDepreciable({ ...a, ...clean, depreciable: true });
      tx.update(ref, { ...clean, history: [...(a.history || []), stamp("Record corrected", note || Object.keys(clean).join(", "))], updatedAt: serverTimestamp() });
    });
    audit("asset_update", "asset", id, patch);
  });
}

/* ---------------- depreciation and Trial Balance ---------------- */
export function postDepreciation(fund, period, jevNo, preview) {
  return wrap(async () => {
    if (!String(jevNo || "").trim()) throw fail("Enter the JEV number.");
    const ref = doc(db, "depreciation", `${fund}_${period}`);
    await runTransaction(db, async tx => {
      if ((await tx.get(ref)).exists()) throw fail(`${period} is already posted.`);
      tx.set(ref, { fund, period, jevNo: jevNo.trim(), amounts: Object.fromEntries(preview.rows.map(r => [r.id, r.amount])),
        byAccount: preview.byAccount, total: preview.total, count: preview.rows.length, postedBy: me(), postedAt: serverTimestamp() });
    });
    audit("depreciation_post", "depreciation", `${fund}_${period}`, { total: preview.total, jevNo });
  });
}
export function unpostDepreciation(fund, period) {
  return wrap(async () => { await deleteDoc(doc(db, "depreciation", `${fund}_${period}`)); audit("depreciation_unpost", "depreciation", `${fund}_${period}`, {}); });
}
export function saveTrialBalance(fund, period, accounts, source) {
  return wrap(async () => {
    if (!Object.keys(accounts).length) throw fail("No account lines were found. Each line needs an 8-digit account code, then debit and credit.");
    await setDoc(doc(db, "tbSnapshots", `${fund}_${period}`), { fund, period, accounts, source, enteredBy: me(), enteredAt: serverTimestamp() });
    audit("tb_save", "tb", `${fund}_${period}`, { accounts: Object.keys(accounts).length });
  });
}

/* ---------------- import of existing PMS / IMS records ---------------- */
/** Writes in batches of 400 (Firestore allows 500 per batch). onProgress(done, total). */
export function importAssets(items, onProgress) {
  return wrap(async () => {
    const { writeBatch } = await import("./fb.js");
    for (let i = 0; i < items.length; i += 400) {
      const b = writeBatch(db);
      for (const it of items.slice(i, i + 400)) {
        const { legacyRef, ...a } = it;
        b.set(doc(collection(db, "assets")), {
          ...a, specs: a.specs || "", estimatedLife: "", custodianUid: "", condition: "Serviceable",
          source: { kind: "import", ref: legacyRef || "", importedAt: new Date().toISOString(), by: me().name },
          history: [stamp("Imported from PMS", legacyRef || "")], createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
      }
      await b.commit();
      onProgress && onProgress(Math.min(items.length, i + 400), items.length);
    }
    audit("import_assets", "asset", "-", { count: items.length });
  });
}

/** Supplies on hand come in as an approved "beginning balance" AIR per fund (up to 300 lines each), already
 *  posted, so the normal RIS issuance draws from them exactly like from a delivery. */
export function importStock(items, asOf) {
  return wrap(async () => {
    const byFund = new Map();
    for (const it of items) { if (!byFund.has(it.fund)) byFund.set(it.fund, []); byFund.get(it.fund).push(it); }
    let n = 0;
    for (const [fund, list] of byFund) {
      for (let i = 0; i < list.length; i += 300) {
        const part = list.slice(i, i + 300), seq = i / 300 + 1;
        const lines = part.map((it, k) => ({ id: `bb${seq}-${k}`, description: it.description, specs: "", unit: it.unit, qty: it.qty, unitCost: it.unitCost,
          amount: round2(it.qty * it.unitCost), kind: "supplies", category: "cons", accountCode: it.accountCode, stockNo: it.stockNo, propertyNo: "", usefulLife: "", issuedQty: 0 }));
        await setDoc(doc(collection(db, "airs")), {
          fund, airNo: `BB-${asOf}${list.length > 300 ? `-${seq}` : ""}`, date: asOf, office: "Beginning balance (imported from IMS)", supplier: "Beginning balance",
          poNo: "", poDate: "", invNo: "", invDate: "", purpose: "Supplies on hand brought over from IMS", imported: true,
          lines, total: linesTotal(lines), status: "approved", endUserUid: S.user.uid, endUserName: me().name, endUserEmail: S.user.email,
          inspection: { dateInspected: asOf, inspectorName: "Imported", inspectedOk: true }, acceptance: { dateReceived: asOf, status: "complete", partialNote: "", custodianName: "" },
          posting: { posted: true, date: asOf, ref: "Beginning balance", remarks: "Imported from IMS", by: me(), at: new Date().toISOString() },
          history: [stamp("Imported from IMS as a beginning balance")], approvedBy: me(), approvedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        n += part.length;
      }
    }
    audit("import_stock", "air", "-", { count: n, asOf });
  });
}

export { remainingQty };
