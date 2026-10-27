// Business rules of the AIR → PAR / ICS / RIS → Accounting posting flow.
// Pure functions only (no Firebase), so the same code runs in the browser and in the tests.
import { DEFAULT_THRESHOLDS, DOC_TYPES, INV_ACCOUNTS, SUPPLY_EXPENSE_NAMES, accountName } from "./catalog.js";

export const round2 = n => Math.round((Number(n) || 0) * 100 + Number.EPSILON * 100) / 100;
export const lineAmount = l => round2((Number(l.qty) || 0) * (Number(l.unitCost) || 0));
export const linesTotal = lines => round2((lines || []).reduce((t, l) => t + lineAmount(l), 0));

/** Proposed category for an AIR line. End-users only say whether a line is equipment/furniture
 *  or supplies; the unit cost then decides PPE vs Semi-Expendable. The GSO can override. */
export function suggestCategory(kind, unitCost, thresholds = DEFAULT_THRESHOLDS) {
  if (kind === "supplies") return "cons";
  return (Number(unitCost) || 0) >= thresholds.capitalization ? "ppe" : "sx";
}
/** Semi-Expendable value class, by unit cost: "high" (SPHV) above the threshold, else "low" (SPLV). */
export function sxClass(unitCost, thresholds = DEFAULT_THRESHOLDS) {
  return (Number(unitCost) || 0) > thresholds.sxHighValue ? "high" : "low";
}

/* ---------------- document numbering (set by the administrator in Settings) ---------------- */
/** Every numbered document. ICS keeps two series (SPLV / SPHV) by value class. */
export const NUMBERED_DOCS = [
  ["air", "AIR — Acceptance and Inspection Report"], ["par", "PAR — Property Acknowledgment Receipt"], ["ics", "ICS — Inventory Custodian Slip"],
  ["ris", "RIS — Requisition and Issue Slip"], ["ptr", "PTR — Property Transfer Report"], ["itr", "ITR — Inventory Transfer Report"],
  ["prs", "PRS — Property Return Slip"], ["rrsp", "RRSP — Receipt of Returned Semi-Expendable Property"], ["dsp", "Disposal report"]
];
export const NUMBER_RESETS = [["monthly", "Every month"], ["yearly", "Every year"], ["never", "Never (one running series)"]];
export const numberingDefault = type => ({ mode: "auto", format: type === "ics" ? "{CLASS}-{YYYY}-{MM}-{####}" : "{YYYY}-{MM}-{####}", reset: "monthly", start: 1 });
/** The numbering in effect for a document type: the saved setting over the default. */
export function numberingFor(settings, type) {
  const c = { ...numberingDefault(type), ...(settings?.numbering?.[type] || {}) };
  c.start = Math.max(1, Math.floor(Number(c.start) || 1));
  return c;
}
const icsPrefix = cls => (cls === "low" ? "SPLV" : "SPHV");
/** The counter a number comes from: one series per fund (and ICS class), restarting by month, year or never.
 *  Monthly series keep the original key (GF_PAR_2026-10), so counters already in use carry on. */
export function seriesKey(cfg, fund, type, date, cls = "") {
  const d = String(date || "");
  if (!/^\d{4}-\d{2}/.test(d)) throw new Error("A valid date is required for numbering.");
  const period = cfg.reset === "yearly" ? d.slice(0, 4) : cfg.reset === "never" ? "ALL" : d.slice(0, 7);
  const prefix = type === "ics" ? icsPrefix(cls) : type.toUpperCase();
  return { key: `${fund}_${prefix}_${period}`, period, prefix };
}
/** Fills a format: {YYYY} {YY} {MM} year and month of the document date, {FUND} GF / SEF / TF, {CLASS} SPLV / SPHV (ICS),
 *  and {###…} the sequence padded to as many digits as there are #. Anything else is printed as typed. */
export function formatDocNo(format, { date, fund = "", cls = "", seq }) {
  const d = String(date || "");
  return String(format || "").replace(/\{(YYYY|YY|MM|FUND|CLASS|#+)\}/g, (_, t) =>
    t === "YYYY" ? d.slice(0, 4) : t === "YY" ? d.slice(2, 4) : t === "MM" ? d.slice(5, 7) : t === "FUND" ? fund : t === "CLASS" ? (cls ? icsPrefix(cls) : "") : String(seq).padStart(t.length, "0"));
}
/** Problems with a numbering setting, or "" when it can be saved. */
export function checkNumbering(type, c) {
  if (c.mode === "manual") return "";
  const f = String(c.format || "");
  if (!/\{#+\}/.test(f)) return "The format needs a sequence number: {####}.";
  if (/\{(?!(YYYY|YY|MM|FUND|CLASS|#+)\})[^}]*\}/.test(f)) return "Unknown part in the format. Use {YYYY}, {YY}, {MM}, {FUND}, {CLASS} or {####}.";
  if (c.reset === "monthly" && !(/\{MM\}/.test(f) && /\{YY(YY)?\}/.test(f))) return "Numbers restart every month, so the format needs {YYYY} (or {YY}) and {MM} — otherwise numbers would repeat.";
  if (c.reset === "yearly" && !/\{YY(YY)?\}/.test(f)) return "Numbers restart every year, so the format needs {YYYY} (or {YY}) — otherwise numbers would repeat.";
  if (type === "ics" && !/\{CLASS\}/.test(f)) return "Low- and high-value ICS have separate series, so the format needs {CLASS} (SPLV / SPHV).";
  if (!(Number(c.start) >= 1)) return "The starting number must be 1 or more.";
  return "";
}
/** A number typed by hand (manual numbering): trimmed, at most 40 characters. */
export const cleanDocNo = v => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 40);

/** Counter key and number with the original PMS / IMS formats (monthly series). */
export function counterKey(fund, type, date, cls = "") {
  const { key, period } = seriesKey(numberingDefault(type), fund, type, date, cls);
  return { key, ym: period, prefix: type === "ics" ? icsPrefix(cls) : type.toUpperCase() };
}
export function formatNumber(type, ym, prefix, seq) {
  const n = `${ym}-${String(seq).padStart(4, "0")}`;
  return type === "ics" ? `${prefix}-${n}` : n;
}

/* ---------------- item list (what was already encoded and approved) ---------------- */
/** Same item, however it was typed: case, spacing and punctuation don't matter. */
export const itemKey = d => String(d || "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();
/** One entry per item description: from the shared item list and from approved AIR lines (the most recent wins). */
export function buildItemCatalog(items = [], airs = []) {
  const map = new Map();
  const put = (e, at) => {
    const key = itemKey(e.description);
    if (!key) return;
    const cur = map.get(key);
    if (cur && cur.at > at) return;
    map.set(key, { key, description: String(e.description).trim(), unit: e.unit || cur?.unit || "", stockNo: e.stockNo || cur?.stockNo || "", category: e.category || cur?.category || "", accountCode: e.accountCode || cur?.accountCode || "", at });
  };
  for (const a of airs) if (["approved", "issued"].includes(a.status)) for (const l of a.lines || []) put(l, String(a.acceptance?.dateReceived || a.date || ""));
  for (const it of items) put(it, String(it.at || ""));
  return map;
}
/** The known item for what is being typed: same description, or (when only the number is typed) same Item No. */
export function findItem(catalog, { description, stockNo } = {}) {
  const k = itemKey(description);
  if (k && catalog.has(k)) return catalog.get(k);
  const n = String(stockNo || "").trim().toUpperCase();
  if (n && !k) return [...catalog.values()].find(e => e.stockNo && e.stockNo.toUpperCase() === n) || null;
  return null;
}

export const remainingQty = l => round2((Number(l.qty) || 0) - (Number(l.issuedQty) || 0));

/** Workflow status of an AIR, as stored. "approved" AIRs are then described by issuance progress. */
export const AIR_STATUS = {
  draft: "Draft", submitted: "For GSO Inspection", returned: "Returned to End-User",
  approved: "For Issuance", issued: "Fully Issued"
};
/** After approval: "issued" once every line has been fully covered by a PAR, ICS or RIS. */
export function statusAfterIssue(lines) {
  return (lines || []).every(l => remainingQty(l) <= 0) ? "issued" : "approved";
}

/** Accounting status of one AIR and the documents issued from it.
 *  Items to post: the AIR receipt itself when it carries supplies (they enter the Supplies Ledger
 *  Card when received), plus every PAR / ICS / RIS issued from it that is not cancelled. */
export function postingSummary(air, docs) {
  const live = (docs || []).filter(d => d.airId === air.id && d.status !== "cancelled");
  const items = [];
  // Accounting posts the AIR (everything received), then each PAR / ICS / RIS issued from it
  items.push({ kind: "air", posted: !!air.posting?.posted });
  live.forEach(d => items.push({ kind: d.docType, posted: !!d.posting?.posted }));
  const posted = items.filter(i => i.posted).length;
  const unissued = (air.lines || []).some(l => remainingQty(l) > 0 && l.category !== "cons");
  let state = "none";
  if (!items.length) state = "none";
  else if (posted === items.length) state = unissued ? "partial" : "posted";
  else if (posted) state = "partial";
  else state = "unposted";
  return { total: items.length, posted, state, unissued };
}
export const POSTING_STATE = { none: "Nothing to post yet", unposted: "Not posted", partial: "Partially posted", posted: "Fully posted" };

/** Validates an AIR before it is submitted to the GSO. Returns a list of problems (empty = ok). */
export function validateAir(a) {
  const errs = [];
  if (!a.fund) errs.push("Choose the fund.");
  if (!a.date) errs.push("Enter the AIR date.");
  if (!String(a.supplier || "").trim()) errs.push("Enter the supplier.");
  if (!String(a.office || "").trim()) errs.push("Enter the requisitioning office.");
  const lines = a.lines || [];
  if (!lines.length) errs.push("Add at least one item.");
  lines.forEach((l, i) => {
    const n = `Item ${i + 1}`;
    if (!String(l.description || "").trim()) errs.push(`${n}: enter the description.`);
    if (!String(l.unit || "").trim()) errs.push(`${n}: enter the unit.`);
    if (!(Number(l.qty) > 0)) errs.push(`${n}: quantity must be more than zero.`);
    if (!(Number(l.unitCost) >= 0) || l.unitCost === "" || l.unitCost == null) errs.push(`${n}: enter the unit cost.`);
  });
  return errs;
}

/** Validates the GSO's inspection before approval. */
export function validateInspection(a) {
  const errs = [];
  if (!a.inspection?.dateInspected) errs.push("Enter the date inspected.");
  if (!a.inspection?.inspectedOk) errs.push("Confirm the items were inspected, verified and found in order.");
  if (!a.acceptance?.dateReceived) errs.push("Enter the date received.");
  if (a.acceptance?.status === "partial" && !String(a.acceptance?.partialNote || "").trim()) errs.push("Specify what was partially received.");
  (a.lines || []).forEach((l, i) => {
    if (!["ppe", "sx", "cons"].includes(l.category)) errs.push(`Item ${i + 1}: choose PPE, Semi-Expendable or Supplies.`);
    if (!l.accountCode) errs.push(`Item ${i + 1}: choose the account code.`);
    if (l.category === "cons" && !String(l.stockNo || "").trim()) errs.push(`Item ${i + 1}: enter the stock number.`);
  });
  return errs;
}

/** Checks an issuance request against the AIR's remaining quantities.
 *  picks: [{ lineId, qty }]. Returns { errors, lines } where lines are the AIR lines with qty set. */
export function checkIssue(air, docType, picks) {
  const errors = [];
  if (!["approved"].includes(air.status)) errors.push("Only an approved AIR with items left to issue can be issued from.");
  const want = DOC_TYPES[docType]?.category;
  if (!want) errors.push("Unknown document type.");
  const chosen = (picks || []).filter(p => Number(p.qty) > 0);
  if (!chosen.length) errors.push("Choose at least one item and quantity to issue.");
  const out = [];
  for (const p of chosen) {
    const l = (air.lines || []).find(x => x.id === p.lineId);
    if (!l) { errors.push("An item is no longer on this AIR."); continue; }
    if (l.category !== want) errors.push(`${l.description}: is not ${DOC_TYPES[docType].short} property.`);
    const qty = round2(p.qty);
    if (qty > remainingQty(l) + 1e-9) errors.push(`${l.description}: only ${remainingQty(l)} ${l.unit} left to issue.`);
    if ((docType === "par" || docType === "ics") && !Number.isInteger(qty)) errors.push(`${l.description}: issue whole units of property.`);
    out.push({ ...l, issueQty: qty });
  }
  return { errors, lines: out };
}

/** Supplies stock cards for one fund: receipts are approved AIR supply lines (on the date received),
 *  issues are RIS lines. Cost is carried per AIR line (specific identification), so the balance in
 *  pesos is exact. */
/** Supplies enter the Inventory Registry when Accounting posts their AIR (postedOnly: false also counts AIRs not yet posted). */
export function stockCards(airs, docs, fund, asOf = "", { postedOnly = true } = {}) {
  const cards = new Map();
  const card = l => {
    const key = String(l.stockNo || "").trim().toUpperCase();
    if (!cards.has(key)) cards.set(key, { stockNo: key, description: l.description, unit: l.unit, accountCode: l.accountCode, moves: [] });
    return cards.get(key);
  };
  for (const a of airs || []) {
    if (a.fund !== fund || !["approved", "issued"].includes(a.status)) continue;
    if (postedOnly && !a.posting?.posted) continue;
    for (const l of a.lines || []) {
      if (l.category !== "cons") continue;
      card(l).moves.push({ date: a.acceptance?.dateReceived || a.date, ref: `AIR ${a.airNo}`, type: "receipt", qty: Number(l.qty) || 0, unitCost: Number(l.unitCost) || 0, office: a.office });
    }
  }
  for (const d of docs || []) {
    if (d.fund !== fund || d.docType !== "ris" || d.status === "cancelled") continue;
    for (const l of d.lines || []) card(l).moves.push({ date: d.date, ref: `RIS ${d.number}`, type: "issue", qty: Number(l.qty) || 0, unitCost: Number(l.unitCost) || 0, office: d.recipient?.office || "" });
  }
  for (const c of cards.values()) {
    if (asOf) c.moves = c.moves.filter(m => String(m.date) <= asOf);
    c.moves.sort((x, y) => String(x.date).localeCompare(String(y.date)) || (x.type === "receipt" ? -1 : 1));
    let q = 0, v = 0;
    for (const m of c.moves) {
      const amt = round2(m.qty * m.unitCost);
      if (m.type === "receipt") { q = round2(q + m.qty); v = round2(v + amt); } else { q = round2(q - m.qty); v = round2(v - amt); }
      Object.assign(m, { amount: amt, balQty: q, balValue: v });
    }
    c.balQty = q; c.balValue = v;
  }
  return [...cards.values()].sort((a, b) => a.stockNo.localeCompare(b.stockNo));
}

/** RSMI lines for RIS issued within [from, to], with the recap by stock number. */
/**
 * Report of Supplies and Materials Issued. Default: RIS dated from–to. With { byJev: true } the RIS are taken by the
 * date of the JEV they were posted under (only posted RIS), so each month's RSMI holds what Accounting posted that month.
 */
export function rsmi(docs, fund, from, to, { byJev = false } = {}) {
  const lines = [];
  for (const d of docs || []) {
    if (d.fund !== fund || d.docType !== "ris" || d.status === "cancelled") continue;
    if (byJev && !d.posting?.posted) continue;
    const when = byJev ? String(d.posting.date || "") : d.date;
    if ((from && when < from) || (to && when > to)) continue;
    for (const l of d.lines || []) lines.push({ risNo: d.number, date: d.date, jevNo: d.posting?.ref || "", jevDate: d.posting?.date || "", office: d.recipient?.office || "", stockNo: l.stockNo, description: l.description, unit: l.unit, qty: Number(l.qty) || 0, unitCost: Number(l.unitCost) || 0, amount: lineAmount(l), accountCode: l.accountCode });
  }
  lines.sort((a, b) => (byJev ? a.jevDate.localeCompare(b.jevDate) : 0) || a.date.localeCompare(b.date) || a.risNo.localeCompare(b.risNo));
  const recap = new Map();
  for (const l of lines) {
    const k = `${l.stockNo}|${l.unitCost}`;
    const r = recap.get(k) || { stockNo: l.stockNo, unitCost: l.unitCost, qty: 0, amount: 0, accountCode: l.accountCode };
    r.qty = round2(r.qty + l.qty); r.amount = round2(r.amount + l.amount); recap.set(k, r);
  }
  return { lines, recap: [...recap.values()].sort((a, b) => a.stockNo.localeCompare(b.stockNo)), total: round2(lines.reduce((t, l) => t + l.amount, 0)),
    jevs: [...new Set(lines.map(l => l.jevNo).filter(Boolean))] };
}
/* ---------------- stock numbers ---------------- */
const STOCK_NO = /^(.*?)(\d+)$/;
/**
 * Stock No. suggested for a supply line from the Inventory Registry: the item's own stock number if it is already there
 * (same description), otherwise the next number in its account's series (OS-0012 → OS-0013), or a new series named after
 * the account (Office Supplies Inventory → OSI-0001). `taken` are numbers already suggested on the same AIR.
 * cards: [{ stockNo, description, accountCode }]
 */
export function suggestStockNo(line, cards, taken = []) {
  const d = String(line.description || "").trim().toLowerCase();
  const same = d && (cards || []).find(c => String(c.description || "").trim().toLowerCase() === d && c.stockNo);
  if (same) return same.stockNo;
  const used = new Set([...(cards || []).map(c => String(c.stockNo || "").toUpperCase()), ...taken.map(t => String(t).toUpperCase())]);
  const ofAcct = (cards || []).filter(c => c.accountCode === line.accountCode && STOCK_NO.test(c.stockNo || ""));
  let prefix, width = 4, n = 0;
  if (ofAcct.length) {
    const last = ofAcct.map(c => c.stockNo.match(STOCK_NO)).sort((a, b) => Number(b[2]) - Number(a[2]))[0];
    prefix = last[1]; width = last[2].length; n = Number(last[2]);
  } else {
    const words = String(accountName(line.accountCode) || "").replace(/\b(and|for|of|the)\b/gi, " ").split(/[^A-Za-z]+/).filter(Boolean);
    prefix = `${(words.map(w => w[0]).join("") || "SN").toUpperCase()}-`;
  }
  let next;
  do next = `${prefix}${String(++n).padStart(width, "0")}`; while (used.has(next.toUpperCase()));
  return next;
}

/* ---------------- property numbers ---------------- */
// Property No. (PPE) / Inventory Item No. (semi-expendable): year purchased - asset group - sub-major account -
// general ledger - series, e.g. 10705020 (Office Equipment) bought in 2026 → 2026-07-05-02-0001.
// The series runs per year across all accounts.
export const propertyNoPrefix = (accountCode, year) => { const c = String(accountCode || ""); return /^\d{8}$/.test(c) ? `${year}-${c.slice(1, 3)}-${c.slice(3, 5)}-${c.slice(5, 7)}` : ""; };
const PROP_NO = /^(\d{4})-\d{2}-\d{2}-\d{2}-(\d{4,})$/;
/** The next series number for a year, after every property number already used that year. */
export function nextPropertySeq(propertyNos, year) {
  let max = 0;
  for (const n of propertyNos || []) { const m = String(n || "").match(PROP_NO); if (m && m[1] === String(year)) max = Math.max(max, Number(m[2])); }
  return max + 1;
}
/** Suggested numbers for lines about to be issued: [{ accountCode, qty }] → one number per unit, in order. */
export function suggestPropertyNos(lines, year, used) {
  let seq = nextPropertySeq(used, year);
  return lines.map(l => { const p = propertyNoPrefix(l.accountCode, year); return p ? `${p}-${String(seq++).padStart(4, "0")}` : ""; });
}

/**
 * The proposed accounting entry for an RSMI: the supplies issued are charged to the expense account of each inventory
 * account (debit) and taken out of inventory (credit), one line per account. An inventory account without a set expense
 * account shows its debit as "to be set".
 */
export function rsmiEntry(lines) {
  const dr = new Map(), cr = new Map();
  for (const l of lines || []) {
    const inv = INV_ACCOUNTS.find(a => a[1] === String(l.accountCode)), exp = inv?.[3] || "";
    const d = dr.get(exp) || { code: exp, name: exp ? SUPPLY_EXPENSE_NAMES[exp] || accountName(exp) || "" : "Expense account to be set", amount: 0 };
    d.amount = round2(d.amount + l.amount); dr.set(exp, d);
    const c = cr.get(l.accountCode) || { code: String(l.accountCode || ""), name: accountName(l.accountCode), amount: 0 };
    c.amount = round2(c.amount + l.amount); cr.set(l.accountCode, c);
  }
  const by = (a, b) => (!a.code) - (!b.code) || a.code.localeCompare(b.code);
  return { debits: [...dr.values()].sort(by), credits: [...cr.values()].sort(by), total: round2([...cr.values()].reduce((t, c) => t + c.amount, 0)) };
}
/** The monthly RSMIs of a fund: one per month in which RIS were posted (by JEV date), newest first. */
export function rsmiMonths(docs, fund) {
  const months = new Map();
  for (const d of docs || []) {
    if (d.fund !== fund || d.docType !== "ris" || d.status === "cancelled" || !d.posting?.posted) continue;
    const p = String(d.posting.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(p)) continue;
    const m = months.get(p) || { period: p, ris: 0, total: 0, jevs: new Set() };
    m.ris++; m.total = round2(m.total + (d.lines || []).reduce((t, l) => t + lineAmount(l), 0)); if (d.posting.ref) m.jevs.add(d.posting.ref);
    months.set(p, m);
  }
  return [...months.values()].map(m => ({ ...m, jevs: [...m.jevs] })).sort((a, b) => b.period.localeCompare(a.period));
}
/** RIS issued but not yet posted: they go into the RSMI of the month Accounting posts them. */
export const risAwaitingPosting = (docs, fund) => (docs || []).filter(d => d.fund === fund && d.docType === "ris" && d.status !== "cancelled" && !d.posting?.posted);
