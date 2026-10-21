// Property register rules: depreciation (straight-line, PMS method), transfers / returns / disposals,
// Trial Balance reconciliation and the import of existing PMS / IMS records. Pure functions only.
import { ppeAccount, isSxAccount, accountCategory, accountByCodeOrName, ZERO_RESIDUAL_ACCOUNTS, INV_ACCOUNTS, PPE_ACCOUNTS, SX_ACCOUNTS, FUNDS } from "./catalog.js";
import { round2 } from "./logic.js";

/* ---------------- periods ---------------- */
export const periodOf = date => String(date || "").slice(0, 7);
export function addMonths(p, n) {
  let [y, m] = p.split("-").map(Number);
  m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
export function periodEnd(p) { const [y, m] = p.split("-").map(Number); return `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; }
export const isPeriod = p => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ""));

/* ---------------- asset basics ---------------- */
/** 5% of cost, or zero for Infrastructure accounts (PMS rule). */
export const residualFor = (code, cost) => ZERO_RESIDUAL_ACCOUNTS.includes(String(code)) ? 0 : round2((Number(cost) || 0) * 0.05);
export const defaultLife = code => ppeAccount(code)?.life || 0;
/** Depreciable: PPE on a depreciable account, with a useful life, not cancelled. */
export function isDepreciable(a) {
  if (a.itemType !== "ppe" || a.status === "cancelled" || a.depreciable === false) return false;
  return !!ppeAccount(a.accountCode)?.depreciable && Number(a.usefulLifeYears) > 0;
}
export const monthlyRate = a => isDepreciable(a) ? ((Number(a.cost) || 0) - (Number(a.residualValue) || 0)) / (Number(a.usefulLifeYears) * 12) : 0;
/** Still owned at the end of `period`: acquired by then, not cancelled, not disposed by then. */
export function ownedAt(a, period) {
  if (a.status === "cancelled") return false;
  if (a.dateAcquired && periodOf(a.dateAcquired) > period) return false;
  if (a.status === "disposed" && (!a.disposal?.date || periodOf(a.disposal.date) <= period)) return false;
  return true;
}

/* ---------------- depreciation ---------------- */
/** Runs are the posted depreciation periods: { fund, period, amounts: { assetId: amount } }. */
export function accumAsOf(a, period, runs) {
  const bp = a.depBaseline?.period;
  let sum = bp && bp <= period ? Number(a.depBaseline.amount) || 0 : 0;
  for (const r of runs || []) if (r.period <= period && (!bp || r.period > bp) && r.amounts?.[a.id]) sum += r.amounts[a.id];
  return round2(sum);
}
export const carryingAmount = (a, period, runs) => round2((Number(a.cost) || 0) - accumAsOf(a, period, runs));

/** Depreciation for `period`: starts the month after acquisition (or after the imported baseline),
 *  stops the month the asset is disposed, and never goes below the residual value. */
export function amountFor(a, period, runs) {
  if (!isDepreciable(a) || !ownedAt(a, period)) return 0;
  if (a.depBaseline?.period && period <= a.depBaseline.period) return 0;
  if (a.dateAcquired && period <= periodOf(a.dateAcquired)) return 0;
  const rate = monthlyRate(a);
  if (rate <= 0) return 0;
  const remaining = round2((Number(a.cost) || 0) - (Number(a.residualValue) || 0) - accumAsOf(a, addMonths(period, -1), runs));
  return remaining <= 0.004 ? 0 : round2(Math.min(rate, remaining));
}

/** Preview of one fund's depreciation for a period, with the JEV summary by account. */
export function depreciationFor(assets, fund, period, runs) {
  const rows = [];
  for (const a of assets || []) {
    if (a.fund !== fund) continue;
    const amt = amountFor(a, period, runs);
    if (amt > 0) rows.push({ id: a.id, propertyNo: a.propertyNo, description: a.description, accountCode: a.accountCode, amount: amt });
  }
  const byAccount = new Map();
  for (const r of rows) {
    const acc = ppeAccount(r.accountCode);
    const e = byAccount.get(r.accountCode) || { code: r.accountCode, name: acc.name, expCode: acc.expCode, expName: acc.expName, adCode: acc.adCode, amount: 0, count: 0 };
    e.amount = round2(e.amount + r.amount); e.count++; byAccount.set(r.accountCode, e);
  }
  return { rows, byAccount: [...byAccount.values()].sort((x, y) => x.code.localeCompare(y.code)), total: round2(rows.reduce((t, r) => t + r.amount, 0)) };
}

/** Periods must be posted in order: the next one is the month after the last posted. */
export function lastPosted(runs, fund) {
  return (runs || []).filter(r => r.fund === fund).map(r => r.period).sort().at(-1) || null;
}
export function checkPostPeriod(runs, fund, period, today) {
  if (!isPeriod(period)) return "Choose a valid period.";
  if (period > periodOf(today)) return "You can't post a future period.";
  const last = lastPosted(runs, fund);
  if (last && period <= last) return `${period} is already posted.`;
  if (last && period !== addMonths(last, 1)) return `Post ${addMonths(last, 1)} first — periods are posted in order.`;
  return "";
}

/* ---------------- transfers, returns, disposals ---------------- */
export const TRANSFER_TYPES = [["reassignment", "Reassignment"], ["relocate", "Relocate"], ["donation", "Donation"], ["others", "Others"]];
export const DISPOSAL_MODES = ["Disposed by sale", "Disposed by destruction / condemnation (IIRUP)", "Transferred out", "Lost / stolen", "Worn out / beyond economical repair", "Returned to supplier", "Other"];

/** Selected assets must be of one kind (PTR is PPE, ITR / RRSP is semi-expendable), held by one person and still on hand. */
export function checkMovement(assets, kind) {
  if (!assets.length) return "Choose at least one item.";
  if (assets.some(a => !["active", "returned"].includes(a.status))) return "Disposed or cancelled items can't be moved.";
  if (new Set(assets.map(a => a.itemType)).size > 1) return "Choose either PPE or semi-expendable items, not both (they go on different forms).";
  if (new Set(assets.map(a => a.fund)).size > 1) return "Choose items from one fund.";
  if (new Set(assets.map(a => String(a.holder?.name || "").trim().toLowerCase())).size > 1) return "Choose items held by the same accountable officer.";
  if (kind === "return" && assets.some(a => a.status === "returned")) return "Some items are already returned to the GSO.";
  return "";
}
export const movementDocType = (kind, itemType) => kind === "transfer" ? (itemType === "ppe" ? "ptr" : "itr") : kind === "return" ? (itemType === "ppe" ? "prs" : "rrsp") : "dsp";

/* ---------------- Trial Balance ---------------- */
/** Paste or CSV rows: code, name, debit, credit (tab or comma separated, header lines ignored). */
export function parseTrialBalance(text) {
  const accounts = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const cols = line.includes("\t") ? line.split("\t") : splitCsv(line);
    if (cols.length < 3) continue;
    const code = String(cols[0]).replace(/[^\d]/g, "");
    if (!/^\d{8}$/.test(code)) continue;
    const n = v => Number(String(v ?? "").replace(/[₱,\s]/g, "").replace(/^\((.*)\)$/, "-$1")) || 0;
    const hasName = cols.length >= 4;
    accounts[code] = { name: hasName ? String(cols[1]).trim() : "", debit: round2(n(cols[hasName ? 2 : 1])), credit: round2(n(cols[hasName ? 3 : 2])) };
  }
  return accounts;
}
export function splitCsv(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out;
}

/** Register vs Trial Balance for one fund at the end of `period`.
 *  stock: { [accountCode]: value } supplies on hand at period end (from the stock cards). */
export function reconcile(assets, runs, stock, tb, fund, period) {
  const reg = new Map();
  const get = code => { if (!reg.has(code)) reg.set(code, { code, cost: 0, ad: 0 }); return reg.get(code); };
  for (const a of assets || []) {
    if (a.fund !== fund || !ownedAt(a, period)) continue;
    const r = get(a.accountCode);
    r.cost = round2(r.cost + (Number(a.cost) || 0));
    if (a.itemType === "ppe") r.ad = round2(r.ad + accumAsOf(a, period, runs));
  }
  for (const [code, v] of Object.entries(stock || {})) get(code).cost = round2(get(code).cost + v);
  const known = new Set([...PPE_ACCOUNTS, ...SX_ACCOUNTS, ...INV_ACCOUNTS].map(a => a[1]));
  for (const code of Object.keys(tb || {})) if (known.has(code)) get(code);
  return [...reg.values()].sort((a, b) => a.code.localeCompare(b.code)).map(r => {
    const acc = ppeAccount(r.code), depr = !!acc?.depreciable, adCode = acc?.adCode || "";
    const t = tb?.[r.code], ta = adCode ? tb?.[adCode] : null;
    const tbCost = t ? round2(t.debit - t.credit) : null;
    const tbAD = ta ? round2(ta.credit - ta.debit) : null;
    const varCost = tbCost == null ? null : round2(r.cost - tbCost);
    const varAD = !depr ? null : round2(r.ad - (tbAD || 0));
    const ok = tbCost != null && Math.abs(varCost) < 1 && (!depr || Math.abs(varAD) < 1);
    return { code: r.code, category: accountCategory(r.code), adCode: depr ? adCode : "", regCost: r.cost, tbCost, varCost, regAD: depr ? r.ad : null, tbAD: depr ? tbAD || 0 : null, varAD, ok };
  });
}

/* ---------------- import of existing PMS / IMS records ---------------- */
const norm = h => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Picks the first column whose normalised header matches one of the aliases. */
function pick(row, ...aliases) {
  const keys = Object.keys(row);
  for (const al of aliases) { const k = keys.find(x => norm(x) === norm(al)); if (k !== undefined && String(row[k] ?? "").trim() !== "") return String(row[k]).trim(); }
  return "";
}
const money = v => round2(Number(String(v || "").replace(/[₱,\s]/g, "")) || 0);
const fundCode = v => { const s = String(v || "").trim(); const f = FUNDS.find(x => x.code.toLowerCase() === s.toLowerCase() || x.name.toLowerCase() === s.toLowerCase()); return f ? f.code : ""; };
function isoDate(v) {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5); return d.toISOString().slice(0, 10); }
  return "";
}

/**
 * Normalises PMS property rows. Accepts the PMS "Asset Register" CSV export, the PMS seed JSON
 * (seed_assets.json) or the import template. Returns { items, errors } — rows with errors are not imported.
 * opts: { fund (default when the row has none), baselinePeriod (as-of period of the accumulated depreciation) }
 */
export function normalizeAssets(rows, opts) {
  const items = [], errors = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const accountCode = accountByCodeOrName(pick(r, "account_code", "Account Code", "UACS"), pick(r, "account_name", "Category", "Account Name", "Account"));
    const type = pick(r, "item_type", "Type").toLowerCase();
    const itemType = type.startsWith("semi") || type === "sx" || isSxAccount(accountCode) ? "sx" : "ppe";
    const status = pick(r, "status", "Status").toLowerCase();
    const cost = money(pick(r, "cost", "Cost", "Total Cost", "Amount"));
    const description = pick(r, "description", "Description", "Item");
    const err = [];
    if (!accountCode) err.push("unknown account");
    if (!description) err.push("no description");
    const retired = /retired|disposed/.test(status);
    if (!(cost > 0) && !retired) err.push("no cost"); // retired PMS items keep their history at ₱0
    const fund = fundCode(pick(r, "fund", "Fund")) || opts.fund;
    if (!fund) err.push("unknown fund");
    if (err.length) { errors.push({ line, description, problem: err.join(", ") }); return; }
    const acc = ppeAccount(accountCode);
    const life = Number(pick(r, "useful_life_years", "Useful Life (yrs)", "Useful Life")) || (itemType === "ppe" ? defaultLife(accountCode) : 0);
    const resid = pick(r, "residual_value", "Residual Value");
    const accum = money(pick(r, "accum_depr_baseline", "Accum. Depr.", "Accumulated Depreciation"));
    const depFlag = pick(r, "depreciable");
    items.push({
      fund, itemType, accountCode, propertyNo: pick(r, "property_id", "Property ID", "Property No.", "Property Number", "SEN", "Item No.").replace(/\.0$/, ""),
      description, specs: pick(r, "remarks", "Remarks", "Specifications"), unit: pick(r, "unit", "Unit") || "unit", qty: Number(pick(r, "qty", "Quantity", "Qty")) || 1,
      cost, unitCost: cost, residualValue: itemType === "ppe" ? (resid !== "" ? money(resid) : residualFor(accountCode, cost)) : 0,
      usefulLifeYears: itemType === "ppe" ? life : 0, depreciable: itemType === "ppe" && !!acc?.depreciable && life > 0 && depFlag !== "false",
      dateAcquired: isoDate(pick(r, "date_acquired", "Date Acquired")) || "",
      holder: { name: pick(r, "accountable_officer", "Accountable Officer", "Officer"), position: "", office: pick(r, "office", "Office", "Dept/Office") },
      location: pick(r, "location", "Location"),
      status: /retired|disposed/.test(status) ? "disposed" : "active",
      disposal: /retired|disposed/.test(status) ? { date: "", reason: "Retired in PMS before the import" } : null,
      depBaseline: itemType === "ppe" && opts.baselinePeriod ? { period: opts.baselinePeriod, amount: accum } : null,
      legacyRef: pick(r, "dv_number", "DV No./Reference", "Reference")
    });
  });
  return { items, errors };
}

/**
 * Normalises IMS supply balances (the IMS "Inventory Registry" CSV export or the opening-balance
 * template): one line per stock number with quantity and unit cost on hand.
 */
export function normalizeStock(rows, opts) {
  const items = [], errors = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const stockNo = pick(r, "Stock No.", "stock_no", "Stock Number").toUpperCase();
    const accountCode = accountByCodeOrName(pick(r, "Account Code", "account_code"), pick(r, "Account Name", "account_name"));
    const qty = round2(Number(pick(r, "Balance Qty", "Qty", "Quantity").replace(/,/g, "")) || 0);
    let unitCost = money(pick(r, "Unit Cost", "unit_cost"));
    const value = money(pick(r, "Balance Value", "Total Cost", "Amount"));
    if (!unitCost && value && qty) unitCost = round2(value / qty);
    const fund = fundCode(pick(r, "Fund", "fund")) || opts.fund;
    const description = pick(r, "Description", "description", "Item");
    const err = [];
    if (!stockNo) err.push("no stock no.");
    if (accountCategory(accountCode) !== "cons") err.push("not an inventory account");
    if (!fund) err.push("unknown fund");
    if (err.length) { errors.push({ line, description, problem: err.join(", ") }); return; }
    if (qty <= 0) return; // nothing on hand: nothing to bring over
    items.push({ fund, stockNo, description, unit: pick(r, "Unit", "unit") || "pc", qty, unitCost, accountCode });
  });
  return { items, errors };
}
