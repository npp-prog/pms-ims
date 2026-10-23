// Every write the app makes. Multi-document changes run in Firestore transactions so numbering and
// issued quantities stay exact even when several people work at the same time.
import {
  db, doc, collection, setDoc, updateDoc, deleteDoc, addDoc, runTransaction, serverTimestamp, arrayUnion, dbError
} from "./fb.js";
import { S, settings, can } from "./state.js";
import { SUPERADMIN_EMAILS, DOC_TYPES, ppeAccount, isSxAccount } from "./core/catalog.js";
import { residualFor, defaultLife, checkMovement, movementDocType, isDepreciable, isPeriod, CIP_COST_FIELDS, cipTotal, repairTotal, hasPostedDepreciation } from "./core/assets.js";
import { specialGroup } from "./core/cards.js";
import {
  round2, lineAmount, linesTotal, validateAir, NUMBERED_DOCS, numberingFor, seriesKey, formatDocNo, cleanDocNo, validateInspection, checkIssue, sxClass,
  statusAfterIssue, remainingQty, itemKey, buildItemCatalog
} from "./core/logic.js";

const me = () => ({ uid: S.user.uid, name: S.account?.displayName || S.user.displayName || S.user.email, email: S.user.email });
const stamp = (action, note = "") => ({ at: new Date().toISOString(), uid: S.user.uid, by: me().name, action, ...(note ? { note } : {}) });
const wrap = async fn => { try { return await fn(); } catch (e) { throw new Error(e.userMessage || dbError(e)); } };
const fail = msg => { const e = new Error(msg); e.userMessage = msg; return e; };

export function audit(action, targetType, targetId, details = {}) {
  return addDoc(collection(db, "auditLogs"), { at: serverTimestamp(), uid: S.user.uid, by: me().name, email: S.user.email, action, targetType, targetId, details })
    .catch(e => console.warn("audit:", e.code || e.message));
}

const DOC_LABEL = Object.fromEntries(NUMBERED_DOCS.map(([k, l]) => [k, l.split(" — ")[0]]));
/** Numbers already on documents loaded in this session (they predate the number register below). */
function numberTaken(fund, type, number) {
  const n = number.toLowerCase(), same = x => x.fund === fund && String(x.number ?? x.airNo ?? "").toLowerCase() === n;
  if (type === "air") return S.d.airs.some(a => a.fund === fund && String(a.airNo || "").toLowerCase() === n);
  if (["par", "ics", "ris"].includes(type)) return S.d.docs.some(d => d.docType === type && same(d));
  return S.d.movements.some(m => m.docType === type && same(m));
}
/**
 * The number for a new document, inside a transaction (reads happen before any write). Automatic numbering takes the
 * next number of its series (starting from the administrator's starting number); manual numbering takes the number typed.
 * Either way the number is claimed in docNumbers/{fund}_{type}_{number}, so it can never be used twice in a fund.
 */
async function readCounter(tx, fund, type, date, cls = "", manual = "") {
  const cfg = numberingFor(S.settings, type);
  let out;
  if (cfg.mode === "manual") {
    const number = cleanDocNo(manual);
    if (!number) throw fail(`Enter the ${DOC_LABEL[type]}${type === "ics" ? ` (${cls === "low" ? "low value, SPLV" : "high value, SPHV"})` : ""} number — numbering is set to manual.`);
    out = { number };
  } else {
    const { key } = seriesKey(cfg, fund, type, date, cls);
    const ref = doc(db, "counters", key);
    const snap = await tx.get(ref);
    const seq = snap.exists() ? (Number(snap.data().seq) || 0) + 1 : cfg.start;
    out = { ref, seq, number: formatDocNo(cfg.format, { date, fund, cls, seq }) };
  }
  out.claim = doc(db, "docNumbers", `${fund}_${type}_${encodeURIComponent(out.number)}`);
  if ((await tx.get(out.claim)).exists() || numberTaken(fund, type, out.number))
    throw fail(`${DOC_LABEL[type]} No. ${out.number} is already used in this fund.${cfg.mode === "auto" ? " Ask the administrator to check the next number in Settings → Document numbering." : ""}`);
  return out;
}
/** Writes the counter (automatic numbering) and the claim on the number. */
function useNumber(tx, c, docRef, type) {
  if (c.ref) tx.set(c.ref, { seq: c.seq, type, updatedAt: serverTimestamp() });
  tx.set(c.claim, { number: c.number, type, path: docRef.path, by: S.user.uid, at: serverTimestamp() });
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
      const airNo = old?.airNo || ""; // the GSO gives the AIR its number when approving it
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
      // the AIR number: given now by the GSO (the next in the series, or typed when numbering is manual)
      let airNo = old.airNo || "";
      if (!airNo) { const c = await readCounter(tx, old.fund, "air", old.date, "", insp.airNo); airNo = c.number; useNumber(tx, c, ref, "air"); }
      // the shared item list, so the next AIR with the same item gets its Item No. as it is typed
      const at = insp.acceptance?.dateReceived || old.date || "";
      for (const l of lines) if (itemKey(l.description)) tx.set(doc(db, "items", itemDocId(l.description)), itemEntry(l, at));
      tx.update(ref, { airNo, lines, inspection: insp.inspection, acceptance: insp.acceptance, gsoRemarks: insp.remarks || "", status: "approved",
        approvedBy: me(), approvedAt: serverTimestamp(), history: [...(old.history || []), stamp(old.airNo ? "Inspected and approved by GSO" : `Inspected and approved by GSO — AIR No. ${airNo}`, insp.remarks || "")], updatedAt: serverTimestamp() });
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
      for (const k of groups.keys()) counters.push(await readCounter(tx, air.fund, docType, header.date, k, header.numbers?.[k || "main"]));
      if (counters.length > 1 && counters[0].number === counters[1].number) throw fail("The low- and high-value ICS need different numbers.");
      [...groups.entries()].forEach(([cls, gl], i) => {
        const c = counters[i];
        const ref = doc(collection(db, "issuances"));
        useNumber(tx, c, ref, docType);
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
      if (d.origin === "register") {
        // PAR / ICS for register items: the items stay in the register, only the link to this document goes
        const snaps = [];
        for (const l of d.lines) snaps.push(await tx.get(doc(db, "assets", l.assetId)));
        tx.update(ref, { status: "cancelled", cancel: { reason, by: me(), at: new Date().toISOString() }, updatedAt: serverTimestamp() });
        snaps.forEach(x => { if (x.exists() && x.data().parIcs?.docId === docId) tx.update(x.ref, { parIcs: null, history: [...(x.data().history || []), stamp(`${d.docType.toUpperCase()} ${d.number} cancelled`, reason)], updatedAt: serverTimestamp() }); });
        return;
      }
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

/** Posts an AIR together with every PAR / ICS / RIS issued from it that is not posted yet — one JEV for all. */
export function postAirWithDocs(airIds, posting) {
  return wrap(async () => {
    if (!posting?.date) throw fail("Enter the posting date.");
    const ref = String(posting.ref || "").trim();
    if (!ref) throw fail("Enter the JEV / reference number.");
    const { writeBatch } = await import("./fb.js");
    const data = { posted: true, date: posting.date, ref, remarks: String(posting.remarks || "").trim(), by: me(), at: new Date().toISOString() };
    const b = writeBatch(db); let n = 0;
    for (const id of [].concat(airIds)) {
      const a = S.d.airs.find(x => x.id === id);
      if (!a) continue;
      if (!a.posting?.posted) { b.update(doc(db, "airs", id), { posting: data, history: arrayUnion(stamp("AIR posted by Accounting", ref)), updatedAt: serverTimestamp() }); n++; }
      for (const d of S.d.docs) if (d.airId === id && d.status === "issued" && !d.posting?.posted) { b.update(doc(db, "issuances", d.id), { posting: data, updatedAt: serverTimestamp() }); n++; }
    }
    if (!n) throw fail("Everything here is already posted.");
    await b.commit();
    audit("post_air", "air", [].concat(airIds).join(","), { ref, count: n });
    return n;
  });
}

/* ---------------- attachments (signed PAR / ICS / RIS, PTR, photos…) ---------------- */
// Firebase Storage needs a paid plan, so files are kept in Firestore itself: the attachment record, and the file
// split into pieces of 600 KB (attachments/{id}/chunks/{n}). A link (e.g. Google Drive) can be attached instead.
export const ATTACH_MAX = 5 * 1024 * 1024;
export const ATTACH_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const CHUNK = 600 * 1024;
const b64 = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
/** target: { type: "issuance" | "asset" | "movement", id, office, fund, label } — f: { label, file } or { label, url } */
export function addAttachment(target, f) {
  return wrap(async () => {
    const label = String(f.label || "").trim() || "Document";
    const base = { target: { type: target.type, id: target.id }, office: target.office || "", fund: target.fund || "", label, about: target.label || "",
      uploadedBy: me(), at: serverTimestamp() };
    const ref = doc(collection(db, "attachments"));
    if (f.url) {
      const url = String(f.url).trim();
      if (!/^https:\/\//i.test(url)) throw fail("The link must start with https://");
      await setDoc(ref, { ...base, kind: "link", url, name: url.replace(/^https:\/\//i, "").slice(0, 80), size: 0, chunks: 0 });
    } else {
      const file = f.file;
      if (!file) throw fail("Choose a file, or paste a link.");
      if (!ATTACH_TYPES.includes(file.type)) throw fail("Attach a PDF, JPG or PNG file.");
      if (file.size > ATTACH_MAX) throw fail(`The file is ${(file.size / 1048576).toFixed(1)} MB; the limit is 5 MB. Scan at a lower resolution, or attach a Google Drive link instead.`);
      const bytes = new Uint8Array(await file.arrayBuffer()), n = Math.ceil(bytes.length / CHUNK) || 1;
      const { writeBatch } = await import("./fb.js");
      const b = writeBatch(db);
      for (let i = 0; i < n; i++) b.set(doc(db, "attachments", ref.id, "chunks", String(i)), { data: b64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)), by: S.user.uid });
      b.set(ref, { ...base, kind: "file", name: file.name.slice(0, 120), mime: file.type, size: file.size, chunks: n }); // the record last: it only shows once the file is complete
      await b.commit();
    }
    audit("attachment_add", target.type, target.id, { label });
    return ref.id;
  });
}
/** The file as a Blob URL (pieces put back together). */
export async function attachmentUrl(a) {
  if (a.kind === "link") return a.url;
  const { getDocs, collection: col } = await import("./fb.js");
  const snap = await getDocs(col(db, "attachments", a.id, "chunks"));
  const parts = snap.docs.sort((x, y) => Number(x.id) - Number(y.id)).map(d => Uint8Array.from(atob(d.data().data), c => c.charCodeAt(0)));
  return URL.createObjectURL(new Blob(parts, { type: a.mime || "application/octet-stream" }));
}
export function removeAttachment(a) {
  return wrap(async () => {
    const { writeBatch } = await import("./fb.js");
    const b = writeBatch(db);
    for (let i = 0; i < (a.chunks || 0); i++) b.delete(doc(db, "attachments", a.id, "chunks", String(i)));
    b.delete(doc(db, "attachments", a.id));
    await b.commit();
    audit("attachment_remove", a.target?.type || "", a.target?.id || "", { label: a.label, name: a.name });
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
/* ---------------- users brought over from PMS ---------------- */
const emailKey = e => String(e || "").trim().toLowerCase();
/**
 * Administrator: PMS users become invitations (invites/{email}) with their role and office. Someone who already
 * registered here with that email is approved right away instead. rows: [{ email, name, role, office, position }]
 */
export function importUsers(rows) {
  return wrap(async () => {
    const { writeBatch } = await import("./fb.js");
    let invited = 0, activated = 0, skipped = 0;
    const byEmail = new Map(S.d.users.map(u => [emailKey(u.email), u]));
    const b = writeBatch(db);
    for (const r of rows) {
      const email = emailKey(r.email), u = byEmail.get(email);
      const office = String(r.office || "").trim(), role = r.role;
      if (u) {
        if (u.status === "active" || u.id === S.user.uid) { skipped++; continue; }
        b.update(doc(db, "users", u.id), { role, status: "active", office: office || u.office || "", note: "Brought over from PMS", reviewedBy: me(), reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        activated++;
      } else {
        b.set(doc(db, "invites", email), { email, displayName: String(r.name || "").trim(), role, office, position: String(r.position || "").trim(), source: "pms", createdBy: me(), createdAt: serverTimestamp() });
        invited++;
      }
    }
    await b.commit();
    audit("users_import", "user", "-", { invited, activated, skipped });
    return { invited, activated, skipped };
  });
}
export const deleteInvite = email => wrap(async () => { await deleteDoc(doc(db, "invites", emailKey(email))); audit("invite_delete", "user", emailKey(email), {}); });
/** The invitation waiting for the signed-in person, if any. */
export async function myInvite() {
  const { getDoc } = await import("./fb.js");
  try { const s = await getDoc(doc(db, "invites", emailKey(S.user.email))); return s.exists() ? s.data() : null; } catch { return null; }
}
/** An invited PMS user activates their account: role and office come from the invitation. */
export function acceptInvite(data, invite) {
  return wrap(async () => {
    await runTransaction(db, async tx => {
      const iref = doc(db, "invites", emailKey(S.user.email));
      const inv = await tx.get(iref);
      if (!inv.exists()) throw fail("The invitation is no longer there. Ask an administrator.");
      const i = inv.data();
      tx.set(doc(db, "users", S.user.uid), {
        uid: S.user.uid, email: S.user.email, displayName: String(data.displayName || i.displayName || "").trim(), office: i.office, position: String(data.position || i.position || "").trim(),
        contact: String(data.contact || "").trim(), photoURL: S.user.photoURL || "", role: i.role, status: "active", note: "Brought over from PMS",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      tx.update(iref, { acceptedUid: S.user.uid, acceptedAt: serverTimestamp() });
    });
    audit("invite_accept", "user", S.user.uid, { role: invite?.role });
  });
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
    displayName: String(data.displayName || "").trim(), position: String(data.position || "").trim(),
    contact: String(data.contact || "").trim(), updatedAt: serverTimestamp()
  }));
}
export function setUserAccess(uid, { role, status, note = "", office }) {
  return wrap(async () => {
    await updateDoc(doc(db, "users", uid), { role, status, note, ...(office ? { office } : {}), reviewedBy: me(), reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    audit("user_access", "user", uid, { role, status, office: office || "" });
  });
}
/** Administrator: the next automatic number of a series (fund, document type, ICS class, period of `date`). */
export function setNextNumber(fund, type, date, cls, next) {
  return wrap(async () => {
    const n = Math.floor(Number(next));
    if (!(n >= 1)) throw fail("The next number must be 1 or more.");
    const cfg = numberingFor(S.settings, type), { key } = seriesKey(cfg, fund, type, date, cls);
    await setDoc(doc(db, "counters", key), { seq: n - 1, updatedAt: serverTimestamp(), setBy: me() });
    audit("numbering_next", "counter", key, { next: n });
    return formatDocNo(cfg.format, { date, fund, cls, seq: n });
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
      const c = await readCounter(tx, assets[0].fund, docType, h.date, "", h.number);
      const mref = doc(collection(db, "movements"));
      useNumber(tx, c, mref, docType);
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
          tx.set(nref, { ...rest, qty: q, cost, ...patch, splitFrom: a.id, createdAt: serverTimestamp() });
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

/* ---------------- register maintenance (PMS): corrections, revaluation, ledger entries ---------------- */
const str = v => String(v ?? "").trim();
const DESCRIPTIVE = ["propertyNo", "location", "condition", "estimatedLife", "description", "specs", "articleType", "remarks", "dvNo", "photoUrl", "docUrl", "unit"];
const linkOk = v => !v || /^https:\/\//i.test(v);
function cleanSpecial(v) { return v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, str(x)]).filter(([, x]) => x)) : null; }
function cleanComponents(v) {
  if (!v || typeof v !== "object") return null;
  const out = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x != null).map(([k, x]) => [k, round2(x)]));
  return Object.keys(out).length ? out : null;
}
/** Residual value: 5% of cost (zero for infrastructure); for a road, the Road Lot value (land is never depreciated). */
function residualOf(code, cost, components) {
  return specialGroup(code) === "road" && components?.lot ? round2(Math.min(cost, components.lot)) : residualFor(code, cost);
}

/**
 * Corrections to a register item. The GSO keeps custody data and descriptions; Accounting can also correct cost,
 * account, date acquired and the opening balances — but only while no depreciation has been posted for the item
 * (after that, use Revalue / Reclassify so the change is dated).
 */
export function updateAsset(id, patch, note) {
  return wrap(async () => {
    if (!str(note)) throw fail("Enter the reason for the correction.");
    if (!linkOk(patch.photoUrl) || !linkOk(patch.docUrl)) throw fail("Photo and document links must start with https://");
    const acct = can("post") || can("manageUsers"), runs = S.d.depr;
    await runTransaction(db, async tx => {
      const ref = doc(db, "assets", id); const snap = await tx.get(ref);
      if (!snap.exists()) throw fail("Record not found.");
      const a = { id, ...snap.data() }, ppe = a.itemType === "ppe";
      const clean = {};
      for (const k of DESCRIPTIVE) if (k in patch) clean[k] = str(patch[k]);
      if ("special" in patch) clean.special = cleanSpecial(patch.special);
      if ("acquisitionType" in patch) clean.acquisition = { type: patch.acquisitionType || "purchased", source: str(patch.acquisitionSource) };
      if (ppe) for (const k of ["usefulLifeYears", "residualValue"]) if (k in patch && patch[k] !== "") clean[k] = k === "residualValue" ? round2(patch[k]) : Number(patch[k]) || 0;
      if ("office" in patch && patch.office !== (a.holder?.office || "")) clean.holder = { ...(a.holder || {}), office: patch.office };
      if (acct) {
        if ("components" in patch) clean.components = cleanComponents(patch.components);
        const locked = hasPostedDepreciation(a, runs);
        const money = { cost: "cost", dateAcquired: "date acquired", accountCode: "account" };
        for (const [k, label] of Object.entries(money)) {
          if (!(k in patch) || patch[k] === "" || String(patch[k]) === String(a[k] ?? "")) continue;
          if (locked) throw fail(`Depreciation has been posted for this item, so its ${label} can't be corrected here. Use ${k === "accountCode" ? "Reclassify" : "Revalue"} instead.`);
          clean[k] = k === "cost" ? round2(patch[k]) : String(patch[k]);
        }
        if (clean.accountCode && (ppe ? !ppeAccount(clean.accountCode) : !isSxAccount(clean.accountCode))) throw fail("Choose an account of the same kind (PPE or semi-expendable).");
        if ("cost" in clean) clean.unitCost = round2(clean.cost / (Number(a.qty) || 1));
        if (ppe && "depBaseline" in patch) {
          const b = patch.depBaseline;
          if (locked && JSON.stringify(b || null) !== JSON.stringify(a.depBaseline || null)) throw fail("Depreciation has been posted, so the opening accumulated depreciation can't change.");
          clean.depBaseline = b && Number(b.amount) > 0 ? { period: b.period, amount: round2(b.amount) } : null;
          if (clean.depBaseline && !isPeriod(clean.depBaseline.period)) throw fail("Enter the month the opening accumulated depreciation is as of.");
        }
        if (!ppe && "priorAdjustment" in patch) clean.priorAdjustment = round2(patch.priorAdjustment || 0);
      }
      if (ppe) clean.depreciable = isDepreciable({ ...a, ...clean, depreciable: true });
      tx.update(ref, { ...clean, history: [...(a.history || []), stamp("Record corrected", `${note} (${Object.keys(clean).filter(k => k !== "depreciable").join(", ")})`)], updatedAt: serverTimestamp() });
    });
    audit("asset_update", "asset", id, { ...patch, note });
  });
}

/** Revaluation (new appraisal or zonal value): the new cost and residual apply from the effective date — Accounting. */
export function revalueAsset(id, f) {
  return wrap(async () => {
    if (!f.date) throw fail("Enter the effective date.");
    if (!(Number(f.newCost) > 0)) throw fail("Enter the new value.");
    if (!str(f.reason)) throw fail("Enter the reason (appraisal, zonal valuation…).");
    await runTransaction(db, async tx => {
      const ref = doc(db, "assets", id); const a = (await tx.get(ref)).data();
      if (a.itemType !== "ppe") throw fail("Only PPE is revalued.");
      if (a.status === "disposed") throw fail("This item is disposed.");
      const newCost = round2(f.newCost), newResidual = f.newResidual === "" || f.newResidual == null ? round2(a.residualValue) : round2(f.newResidual);
      if (newResidual > newCost) throw fail("The residual value can't be more than the new value.");
      const entry = { date: f.date, oldCost: a.cost, newCost, oldResidual: a.residualValue || 0, newResidual, reason: str(f.reason), ref: str(f.ref), kind: "revaluation", by: me().name, at: new Date().toISOString() };
      tx.update(ref, { cost: newCost, unitCost: round2(newCost / (Number(a.qty) || 1)), residualValue: newResidual, revaluations: [...(a.revaluations || []), entry],
        history: [...(a.history || []), stamp(`Revalued ${a.cost} → ${newCost}`, entry.reason)], updatedAt: serverTimestamp() });
    });
    audit("asset_revalue", "asset", id, f);
  });
}

/** Ledger entry: an adjustment (write-up / write-down; negative lowers the cost) or an impairment loss — Accounting. */
export function addLedgerEntry(id, f) {
  return wrap(async () => {
    if (!["adjustment", "impairment"].includes(f.type)) throw fail("Choose the entry type.");
    if (!f.date) throw fail("Enter the date.");
    const amount = round2(f.amount);
    if (!amount) throw fail("Enter the amount.");
    if (f.type === "impairment" && amount < 0) throw fail("Enter the impairment loss as a positive amount.");
    await runTransaction(db, async tx => {
      const ref = doc(db, "assets", id); const a = (await tx.get(ref)).data();
      const entry = { type: f.type, date: f.date, amount, ref: str(f.ref), note: str(f.note), by: me().name, at: new Date().toISOString() };
      tx.update(ref, { adjustments: [...(a.adjustments || []), entry], history: [...(a.history || []), stamp(f.type === "impairment" ? `Impairment loss ${amount}` : `Adjustment ${amount}`, entry.note)], updatedAt: serverTimestamp() });
    });
    audit("asset_ledger_entry", "asset", id, f);
  });
}
/** Removes a ledger entry recorded by mistake (by its timestamp) — Accounting. */
export function removeLedgerEntry(id, at, reason) {
  return wrap(async () => {
    await runTransaction(db, async tx => {
      const ref = doc(db, "assets", id); const a = (await tx.get(ref)).data();
      const e = (a.adjustments || []).find(x => x.at === at); if (!e) throw fail("Entry not found.");
      tx.update(ref, { adjustments: a.adjustments.filter(x => x.at !== at), history: [...(a.history || []), stamp(`Removed ${e.type} of ${e.amount} dated ${e.date}`, reason)], updatedAt: serverTimestamp() });
    });
    audit("asset_ledger_remove", "asset", id, { at, reason });
  });
}

/** Account reclassification and/or fund transfer, effective from a date (depreciation and reconciliation follow it) — Accounting. */
export function reclassifyAsset(id, f) {
  return wrap(async () => {
    if (!f.date) throw fail("Enter the effective date.");
    if (!str(f.reason)) throw fail("Enter the reason.");
    await runTransaction(db, async tx => {
      const ref = doc(db, "assets", id); const a = (await tx.get(ref)).data();
      const patch = {}, notes = [];
      if (f.accountCode && f.accountCode !== a.accountCode) {
        if (a.itemType === "ppe" ? !ppeAccount(f.accountCode) : !isSxAccount(f.accountCode)) throw fail("Choose an account of the same kind (PPE or semi-expendable).");
        patch.accountCode = f.accountCode;
        patch.accountChanges = [...(a.accountChanges || []), { date: f.date, oldCode: a.accountCode, newCode: f.accountCode, reason: str(f.reason), by: me().name, at: new Date().toISOString() }];
        if (a.itemType === "ppe") patch.depreciable = isDepreciable({ ...a, accountCode: f.accountCode, depreciable: true });
        notes.push(`account ${a.accountCode} → ${f.accountCode}`);
      }
      if (f.fund && f.fund !== a.fund) {
        patch.fund = f.fund;
        patch.fundChanges = [...(a.fundChanges || []), { date: f.date, oldFund: a.fund, newFund: f.fund, reason: str(f.reason), by: me().name, at: new Date().toISOString() }];
        notes.push(`fund ${a.fund} → ${f.fund}`);
      }
      if (!notes.length) throw fail("Choose a different account or fund.");
      tx.update(ref, { ...patch, history: [...(a.history || []), stamp(`Reclassified: ${notes.join("; ")}`, str(f.reason))], updatedAt: serverTimestamp() });
    });
    audit("asset_reclassify", "asset", id, f);
  });
}

/** Brings a disposed item back (disposed by mistake, found again): the earlier disposal stays on record — Accounting. */
export function reactivateAsset(id, f) {
  return wrap(async () => {
    if (!f.date) throw fail("Enter the date.");
    if (!str(f.reason)) throw fail("Enter the reason.");
    await runTransaction(db, async tx => {
      const ref = doc(db, "assets", id); const a = (await tx.get(ref)).data();
      if (a.status !== "disposed") throw fail("Only a disposed item can be reactivated.");
      tx.update(ref, { status: "active", disposal: null, reactivations: [...(a.reactivations || []), { date: f.date, reason: str(f.reason), previousDisposal: a.disposal || null, by: me().name, at: new Date().toISOString() }],
        history: [...(a.history || []), stamp("Reactivated", str(f.reason))], updatedAt: serverTimestamp() });
    });
    audit("asset_reactivate", "asset", id, f);
  });
}

/** Edits the printed details of a PTR / ITR / PRS / RRSP / disposal (signatories, reason, reference) — the items are not touched. */
export function editMovementDetails(id, f) {
  return wrap(async () => {
    const patch = { reason: str(f.reason), ref: str(f.ref), typeOther: str(f.typeOther),
      approvedBy: { name: str(f.approvedBy?.name), position: str(f.approvedBy?.position) }, issuedBy: { name: str(f.issuedBy?.name), position: str(f.issuedBy?.position) },
      edited: arrayUnion({ by: me().name, at: new Date().toISOString() }), updatedAt: serverTimestamp() };
    await updateDoc(doc(db, "movements", id), patch);
    audit("movement_edit", "movement", id, {});
  });
}

/* ---------------- depreciation and Trial Balance ---------------- */
/** override: { reason } when an administrator posts although the prior month's Trial Balance doesn't tie out. */
export function postDepreciation(fund, period, jevNo, preview, override = null) {
  return wrap(async () => {
    if (!String(jevNo || "").trim()) throw fail("Enter the JEV number.");
    if (override && !str(override.reason)) throw fail("Enter the reason for posting without a tied-out Trial Balance.");
    const ref = doc(db, "depreciation", `${fund}_${period}`);
    await runTransaction(db, async tx => {
      if ((await tx.get(ref)).exists()) throw fail(`${period} is already posted.`);
      tx.set(ref, { fund, period, jevNo: jevNo.trim(), amounts: Object.fromEntries(preview.rows.map(r => [r.id, r.amount])),
        byAccount: preview.byAccount, total: preview.total, count: preview.rows.length, postedBy: me(), postedAt: serverTimestamp(),
        ...(override ? { override: { reason: str(override.reason), by: me(), at: new Date().toISOString() } } : {}) });
    });
    audit(override ? "depreciation_post_override" : "depreciation_post", "depreciation", `${fund}_${period}`, { total: preview.total, jevNo, ...(override ? { reason: override.reason } : {}) });
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
const itemDocId = d => encodeURIComponent(itemKey(d)).slice(0, 700);
const itemEntry = (l, at) => ({ description: String(l.description || "").trim(), unit: l.unit || "", stockNo: l.stockNo || "", category: l.category || "", accountCode: l.accountCode || "", at: String(at || ""), updatedAt: serverTimestamp() });
/** Administrator: fills the item list from every approved AIR already in the system (run once after updating). */
export function rebuildItemList() {
  return wrap(async () => {
    const { writeBatch } = await import("./fb.js");
    const cat = [...buildItemCatalog([], S.d.airs).values()];
    for (let i = 0; i < cat.length; i += 400) {
      const b = writeBatch(db);
      cat.slice(i, i + 400).forEach(e => b.set(doc(db, "items", itemDocId(e.description)), itemEntry(e, e.at)));
      await b.commit();
    }
    audit("items_rebuild", "items", "-", { count: cat.length });
    return cat.length;
  });
}
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
        const { writeBatch } = await import("./fb.js"), ib = writeBatch(db);
        lines.forEach(l => ib.set(doc(db, "items", itemDocId(l.description)), itemEntry(l, asOf)));
        await ib.commit();
        n += part.length;
      }
    }
    audit("import_stock", "air", "-", { count: n, asOf });
  });
}

/* ---------------- Construction in Progress and SWA ---------------- */
const cipFields = f => ({ fund: f.fund, accountCode: f.accountCode, cipNo: String(f.cipNo || "").trim(), name: String(f.name || "").trim(), location: String(f.location || "").trim(),
  contractor: String(f.contractor || "").trim(), contractPeriod: String(f.contractPeriod || "").trim(), projectCost: round2(f.projectCost) });

export function saveCip(id, f) {
  return wrap(async () => {
    const data = cipFields(f);
    if (!data.cipNo) throw fail("Enter the CIP No.");
    if (!data.name) throw fail("Enter the name of the project.");
    if (id) await updateDoc(doc(db, "cipProjects", id), { ...data, updatedAt: serverTimestamp(), updatedBy: me() });
    else {
      const ref = await addDoc(collection(db, "cipProjects"), { ...data, status: "in_progress", statusOverride: null, billings: [], completed: null, createdBy: me(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      id = ref.id;
    }
    audit("cip_save", "cip", id, { cipNo: data.cipNo });
    return id;
  });
}
export function importCip(projects) {
  return wrap(async () => {
    const { writeBatch } = await import("./fb.js");
    for (let i = 0; i < projects.length; i += 400) {
      const b = writeBatch(db);
      for (const p of projects.slice(i, i + 400))
        b.set(doc(collection(db, "cipProjects")), { ...p, status: "in_progress", statusOverride: null, completed: null, imported: true, createdBy: me(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await b.commit();
    }
    audit("import_cip", "cip", "-", { count: projects.length });
  });
}
export const setCipOverride = (id, v) => wrap(() => updateDoc(doc(db, "cipProjects", id), { statusOverride: v || null, updatedAt: serverTimestamp() }));

/** Adds or edits a billing; matching an SWA locks that SWA to this billing (and releases the one it replaces). */
export function saveBilling(projectId, billingId, entry, swaId) {
  return wrap(async () => {
    if (!entry.date) throw fail("Enter the transaction date.");
    await runTransaction(db, async tx => {
      const pref = doc(db, "cipProjects", projectId); const p = (await tx.get(pref)).data();
      if (p.status === "completed") throw fail("This project was already transferred to PPE.");
      const billings = [...(p.billings || [])];
      const i = billingId ? billings.findIndex(b => b.id === billingId) : -1;
      const old = i >= 0 ? billings[i] : null;
      const prevSwa = old?.swaId || null, nextSwa = swaId || null;
      let swaDoc = null;
      if (nextSwa && nextSwa !== prevSwa) {
        swaDoc = await tx.get(doc(db, "swa", nextSwa));
        if (!swaDoc.exists() || swaDoc.data().matched) throw fail("That SWA is already matched to another billing.");
      }
      const id = old?.id || uidLocal();
      const clean = { id, date: entry.date, ref: String(entry.ref || "").trim(), particulars: String(entry.particulars || "").trim(), remarks: String(entry.remarks || "").trim(),
        ...Object.fromEntries(CIP_COST_FIELDS.map(([k]) => [k, round2(entry[k])])), swaId: nextSwa, swaNo: nextSwa ? (swaDoc?.data().swaNo || old?.swaNo || "") : "", by: me().name, at: new Date().toISOString() };
      if (i >= 0) billings[i] = clean; else billings.push(clean);
      tx.update(pref, { billings, updatedAt: serverTimestamp() });
      if (prevSwa && prevSwa !== nextSwa) tx.update(doc(db, "swa", prevSwa), { matched: false, matchedProjectId: null, matchedBillingId: null, updatedAt: serverTimestamp() });
      if (nextSwa && nextSwa !== prevSwa) tx.update(doc(db, "swa", nextSwa), { matched: true, matchedProjectId: projectId, matchedBillingId: id, updatedAt: serverTimestamp() });
    });
    audit("cip_billing", "cip", projectId, { ref: entry.ref });
  });
}
export function deleteBilling(projectId, billingId) {
  return wrap(async () => {
    await runTransaction(db, async tx => {
      const pref = doc(db, "cipProjects", projectId); const p = (await tx.get(pref)).data();
      if (p.status === "completed") throw fail("This project was already transferred to PPE.");
      const b = (p.billings || []).find(x => x.id === billingId);
      tx.update(pref, { billings: p.billings.filter(x => x.id !== billingId), updatedAt: serverTimestamp() });
      if (b?.swaId) tx.update(doc(db, "swa", b.swaId), { matched: false, matchedProjectId: null, matchedBillingId: null, updatedAt: serverTimestamp() });
    });
    audit("cip_billing_delete", "cip", projectId, {});
  });
}
const uidLocal = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Complete → transfer to PPE: the billed total becomes a new PPE record (split into building / road components
 *  when given), or — for roads — is added to an existing road as an addition dated the completion date. */
export function completeCip(id, f) {
  return wrap(async () => {
    if (!f.date) throw fail("Enter the date completed.");
    const addTo = f.mode === "add" && f.targetAssetId;
    if (f.mode === "add" && !f.targetAssetId) throw fail("Choose the road to add to.");
    if (!addTo && !ppeAccount(f.accountCode)) throw fail("Choose the PPE account.");
    let assetId = null;
    await runTransaction(db, async tx => {
      const pref = doc(db, "cipProjects", id); const p = (await tx.get(pref)).data();
      if (p.status === "completed") throw fail("Already transferred.");
      const total = cipTotal(p);
      if (total <= 0) throw fail("This project has no billings to transfer yet.");
      if (addTo) {
        const aref = doc(db, "assets", f.targetAssetId); const snap = await tx.get(aref);
        if (!snap.exists()) throw fail("Choose the road to add to.");
        const a = snap.data(); assetId = aref.id;
        if (a.status === "disposed" || a.status === "cancelled") throw fail("That item is disposed.");
        if (a.fund !== p.fund) throw fail("The road is in another fund.");
        const comp = f.component || (specialGroup(a.accountCode) === "road" ? "pavement" : "");
        const components = { ...(a.components || {}) };
        if (comp) components[comp] = round2((Number(components[comp]) || 0) + total);
        const newCost = round2(a.cost + total), newResidual = comp === "lot" ? round2((a.residualValue || 0) + total) : a.residualValue || 0;
        const entry = { date: f.date, oldCost: a.cost, newCost, oldResidual: a.residualValue || 0, newResidual, reason: `CIP transfer — CIP ${p.cipNo} ${p.name}`, ref: `CIP ${p.cipNo}`, kind: "addition", cipId: id, by: me().name, at: new Date().toISOString() };
        tx.update(aref, { cost: newCost, unitCost: round2(newCost / (Number(a.qty) || 1)), residualValue: newResidual, components, revaluations: [...(a.revaluations || []), entry],
          history: [...(a.history || []), stamp(`Addition from CIP ${p.cipNo}: ${total}`, comp ? `component: ${comp}` : "")], updatedAt: serverTimestamp() });
        tx.update(pref, { status: "completed", completed: { date: f.date, assetId, accountCode: a.accountCode, total, mode: "add", by: me() }, updatedAt: serverTimestamp() });
        return;
      }
      const aref = doc(collection(db, "assets")); assetId = aref.id;
      const life = Number(f.life) || defaultLife(f.accountCode);
      const components = cleanComponents(f.components);
      if (components && Math.abs(Object.values(components).reduce((t, v) => t + v, 0) - total) >= 0.01) throw fail(`The components must add up to the billed total (${total}).`);
      tx.set(aref, {
        fund: p.fund, itemType: "ppe", accountCode: f.accountCode, propertyNo: str(f.propertyNo), description: p.name, specs: `Transferred from CIP ${p.cipNo}${p.contractor ? ` · ${p.contractor}` : ""}`,
        unit: "lot", qty: 1, unitCost: total, cost: total, residualValue: f.residual !== "" && f.residual != null ? round2(f.residual) : residualOf(f.accountCode, total, components),
        usefulLifeYears: life, estimatedLife: "", depreciable: !!ppeAccount(f.accountCode).depreciable && life > 0, dateAcquired: f.date,
        holder: { name: str(f.holder), position: "", office: str(f.location || p.location) }, custodianUid: "", location: str(f.location || p.location),
        status: "active", condition: "Serviceable", source: { kind: "cip", docId: id, number: p.cipNo }, depBaseline: null, disposal: null,
        components, special: cleanSpecial(f.special), revaluations: [], adjustments: [],
        history: [stamp(`Transferred from CIP ${p.cipNo} (${p.billings.length} billings)`)], createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      tx.update(pref, { status: "completed", completed: { date: f.date, assetId: aref.id, accountCode: f.accountCode, total, mode: "new", by: me() }, updatedAt: serverTimestamp() });
    });
    audit("cip_complete", "cip", id, { assetId, mode: addTo ? "add" : "new" });
    return assetId;
  });
}

/** Releases an SWA from the billing it was matched to (the billing stays, without the SWA). */
export function unmatchSwa(swaId) {
  return wrap(async () => {
    await runTransaction(db, async tx => {
      const sref = doc(db, "swa", swaId); const w = (await tx.get(sref)).data();
      if (!w?.matched) throw fail("This SWA isn't matched.");
      if (w.matchedProjectId) {
        const pref = doc(db, "cipProjects", w.matchedProjectId); const p = (await tx.get(pref)).data();
        if (p?.status === "completed") throw fail("That project was already transferred to PPE, so its billings are closed.");
        if (p) tx.update(pref, { billings: (p.billings || []).map(b => b.swaId === swaId ? { ...b, swaId: null, swaNo: "" } : b), updatedAt: serverTimestamp() });
      }
      tx.update(sref, { matched: false, matchedProjectId: null, matchedBillingId: null, updatedAt: serverTimestamp() });
    });
    audit("swa_unmatch", "swa", swaId, {});
  });
}

export function saveSwa(id, f) {
  return wrap(async () => {
    const data = { fund: f.fund, date: f.date, cipNo: String(f.cipNo || "").trim(), swaNo: String(f.swaNo || "").trim(), contractor: String(f.contractor || "").trim(),
      cost: round2(f.cost), percent: f.percent === "" || f.percent == null ? null : round2(f.percent), docLink: String(f.docLink || "").trim(), remarks: String(f.remarks || "").trim() };
    if (!data.swaNo) throw fail("Enter the SWA No.");
    if (data.docLink && !/^https?:\/\//i.test(data.docLink)) throw fail("The document link must start with https://");
    if (id) await updateDoc(doc(db, "swa", id), { ...data, updatedAt: serverTimestamp() });
    else id = (await addDoc(collection(db, "swa"), { ...data, matched: false, matchedProjectId: null, matchedBillingId: null, createdBy: me(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })).id;
    audit("swa_save", "swa", id, { swaNo: data.swaNo });
    return id;
  });
}
export const deleteSwa = id => wrap(() => deleteDoc(doc(db, "swa", id)));

/* ---------------- History of Repair ---------------- */
/** End-Users record repairs of property under their name; the GSO verifies (or returns) them. */
export function saveRepair(id, f, asset) {
  return wrap(async () => {
    const parts = (f.parts || []).map(l => ({ qty: Number(l.qty) || 0, unit: String(l.unit || "").trim(), description: String(l.description || "").trim(), cost: round2(l.cost), remarks: String(l.remarks || "").trim() }))
      .filter(l => l.description || l.cost || l.qty);
    if (!asset) throw fail("Choose the item that was repaired.");
    if (!String(f.jobOrderNo || "").trim()) throw fail("Enter the Job Order No.");
    if (!f.jobOrderDate) throw fail("Enter the Job Order date.");
    if (!parts.length) throw fail("Add at least one spare part, material or labor line.");
    const data = {
      fund: asset.fund, assetId: asset.id, propertyNo: asset.propertyNo || "", description: asset.description,
      makeModel: String(f.makeModel || "").trim(), unitSerialNo: String(f.unitSerialNo || "").trim(), engineSerialNo: String(f.engineSerialNo || "").trim(), plateNo: String(f.plateNo || "").trim(),
      endUser: String(f.endUser || "").trim(), designation: String(f.designation || "").trim(), office: String(f.office || "").trim(),
      jobOrderNo: f.jobOrderNo.trim(), jobOrderDate: f.jobOrderDate, invoiceNo: String(f.invoiceNo || "").trim(), invoiceDate: f.invoiceDate || "", supplier: String(f.supplier || "").trim(),
      nature: String(f.nature || "").trim(), parts, totalCost: repairTotal({ parts }), preparedBy: { name: String(f.preparedBy || "").trim(), position: String(f.preparedByPos || "").trim() },
      notedBy: { name: String(f.notedBy || "").trim(), position: String(f.notedByPos || "").trim() }, status: "submitted", updatedAt: serverTimestamp()
    };
    if (id) await updateDoc(doc(db, "repairs", id), data);
    else id = (await addDoc(collection(db, "repairs"), { ...data, endUserUid: asset.custodianUid === S.user.uid ? S.user.uid : (asset.custodianUid || ""), encodedBy: me(), createdAt: serverTimestamp() })).id;
    audit("repair_save", "repair", id, { jobOrderNo: data.jobOrderNo, total: data.totalCost });
    return id;
  });
}
export const deleteRepair = id => wrap(() => deleteDoc(doc(db, "repairs", id)));
/** GSO: verify (the repair is added to the item's history) or return with remarks. */
export function reviewRepair(id, verify, remarks, verifiedBy) {
  return wrap(async () => {
    await runTransaction(db, async tx => {
      const rref = doc(db, "repairs", id); const r = (await tx.get(rref)).data();
      if (r.status !== "submitted") throw fail("Only a repair waiting for verification can be reviewed.");
      const aref = doc(db, "assets", r.assetId); const a = verify ? (await tx.get(aref)).data() : null;
      tx.update(rref, { status: verify ? "verified" : "returned", gsoRemarks: remarks || "", verifiedBy: verify ? verifiedBy : null, reviewedBy: me(), reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      if (verify && a) tx.update(aref, { history: [...(a.history || []), stamp(`Repaired — JO ${r.jobOrderNo} (₱${r.totalCost.toLocaleString("en-PH", { minimumFractionDigits: 2 })})`, r.nature || r.parts.map(l => l.description).join(", "))], updatedAt: serverTimestamp() });
    });
    audit(verify ? "repair_verify" : "repair_return", "repair", id, { remarks });
  });
}

export { remainingQty };
