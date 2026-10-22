// Printed-card data (PMS Equipment Ledger Card / Property Card and their special forms): one dated
// event list per item with running cost, accumulated depreciation, impairment and adjusted cost.
// Pure functions only, shared with the tests.
import { round2 } from "./logic.js";
import { periodEnd, periodOf } from "./assets.js";

/** Which special COA card an account prints on (PMS): land, road, otherinfra, buildings, biological — or "" for the generic card. */
export function specialGroup(code) {
  const c = String(code || "");
  if (c.startsWith("10701") || c.startsWith("10702")) return "land";
  if (c === "10703010") return "road";
  if (c.startsWith("10703")) return "otherinfra";
  if (c.startsWith("10704")) return "buildings";
  if (c.startsWith("108")) return "biological";
  return "";
}
/** The extra header fields each special card needs (stored on the asset under `special`). */
export const SPECIAL_FIELDS = {
  land: [["lotId", "Lot ID No."], ["classification", "Classification"], ["area", "Area"], ["technicalDesc", "Technical description"]],
  road: [["roadId", "Road Network ID No."], ["roadType", "Type of road (PCCP / asphalt / gravel)"], ["length", "Length"], ["width", "Width"], ["thickness", "Thickness (pavement)"]],
  otherinfra: [["infraId", "Public Infrastructure ID No."], ["infraType", "Type"], ["otherDesc", "Other detailed description"]],
  buildings: [["bldgId", "Building / Structure ID No."], ["typeMade", "Type / made (concrete, wood)"], ["floorArea", "Floor area"], ["floors", "No. of floors"]],
  biological: [["headCount", "Head count / quantity"]]
};
/** Cost components printed on the Road and Buildings cards. */
export const COMPONENTS = {
  road: [["lot", "A. Road Lot"], ["pavement", "B. Pavement"], ["drainage", "C. Drainage and Slope Protection Structures"], ["other", "D. Other Miscellaneous Structures"]],
  buildings: [["building", "A. Building"], ["aircon", "B. Air Conditioning System"], ["elevators", "C. Elevators / Escalators"], ["others", "D. Others"]],
  otherinfra: [["a", "A."], ["b", "B."], ["c", "C."], ["d", "D. Others"]]
};

export const ACQUISITION_TYPES = [["purchased", "Purchased / acquired"], ["donated", "Donated"], ["found", "Found at the station"], ["transferred", "Transferred in from another agency"]];
const acqLabel = t => (ACQUISITION_TYPES.find(x => x[0] === t) || [])[1] || "";

/** Where the item came from, for the card's acquisition row. */
export function acquisitionRef(a) {
  const src = a.source?.kind === "import" ? "Brought forward from PMS" : a.source?.kind === "manual" ? "" : a.source?.kind === "cip" ? `CIP ${a.source.number}` : a.source?.number ? `${a.source.kind.toUpperCase()} ${a.source.number}` : "";
  const acq = a.acquisition?.type && a.acquisition.type !== "purchased" ? `${acqLabel(a.acquisition.type)}${a.acquisition.source ? ` — ${a.acquisition.source}` : ""}` : "";
  return [src, a.parIcs?.number ? `${a.parIcs.docType.toUpperCase()} ${a.parIcs.number}` : "", a.dvNo, a.source?.ref, acq].filter(Boolean).join(" — ");
}

const MOVE_KIND = { ptr: "transfer", itr: "transfer", prs: "return", rrsp: "return", dsp: "retire" };

/**
 * The item's history as card rows, oldest first.
 * ctx: { runs: posted depreciation (any fund), movements, repairs }
 * Row: { date, kind, label, reference, cost, accum, impairment, adjusted, sxAdjusted, adjustment, repairNature, repairAmount, officer, qty }
 */
export function assetTimeline(a, ctx = {}) {
  const ev = [];
  ev.push({ date: a.dateAcquired || "", kind: "acquire", label: "Acquisition", reference: acquisitionRef(a), order: 0 });
  if (a.depBaseline?.period) ev.push({ date: periodEnd(a.depBaseline.period), kind: "baseline", label: `Balance forward as of ${a.depBaseline.period}`, reference: "", order: 1 });
  for (const r of a.revaluations || [])
    ev.push({ date: r.date, kind: "revalue", label: r.kind === "addition" ? `Addition — ${r.reason || ""}` : `Revaluation${r.reason ? ` — ${r.reason}` : ""}`, reference: r.ref || "", newCost: Number(r.newCost) || 0, order: 2 });
  for (const e of a.adjustments || [])
    ev.push({ date: e.date, kind: e.type, label: e.type === "impairment" ? `Impairment loss${e.note ? ` — ${e.note}` : ""}` : `Adjustment${e.note ? ` — ${e.note}` : ""}`, reference: e.ref || "", amount: Number(e.amount) || 0, order: 3 });
  for (const m of ctx.movements || []) {
    if (m.status === "cancelled") continue;
    const l = (m.lines || []).find(x => x.assetId === a.id);
    if (!l) continue;
    const donation = m.transferType === "donation";
    const kind = donation ? "retire" : MOVE_KIND[m.docType];
    ev.push({ date: m.date, kind, reference: `${m.docType === "dsp" ? "Disposal" : m.docType.toUpperCase()} ${m.number}`, officer: m.to?.name || "", office: m.to?.office || "", qty: l.qty,
      label: kind === "transfer" ? `Transfer to ${m.to?.name || "—"}${m.reason ? ` (${m.reason})` : ""}` : kind === "return" ? `Returned to the GSO${m.reason ? ` (${m.reason})` : ""}` : donation ? `Donated to ${m.to?.name || "—"}` : `Disposed — ${m.mode || ""}`, order: 5 });
  }
  if (a.status === "disposed" && !ev.some(e => e.kind === "retire"))
    ev.push({ date: a.disposal?.date || "", kind: "retire", label: `Disposed — ${a.disposal?.reason || ""}`, reference: a.disposal?.ref || "", order: 6 });
  for (const rc of a.reactivations || []) ev.push({ date: rc.date, kind: "reactivate", label: `Reactivated — ${rc.reason || ""}`, reference: "", order: 6 });
  for (const r of ctx.runs || []) {
    const amt = r.amounts?.[a.id];
    if (amt) ev.push({ date: periodEnd(r.period), kind: "depreciation", period: r.period, label: `Depreciation for ${r.period}`, reference: r.jevNo ? `JEV ${r.jevNo}` : "", amount: amt, order: 4 });
  }
  for (const r of ctx.repairs || []) if (r.assetId === a.id && r.status === "verified")
    ev.push({ date: r.jobOrderDate, kind: "repair", label: `Repair — JO ${r.jobOrderNo}`, reference: `JO ${r.jobOrderNo}`, repairNature: r.nature || r.parts.map(p => p.description).join(", "), repairAmount: Number(r.totalCost) || 0, order: 3 });
  ev.sort((x, y) => String(x.date).localeCompare(String(y.date)) || x.order - y.order);
  // running balances: cost starts at the original cost (before any revaluation)
  const rv = [...(a.revaluations || [])].sort((x, y) => String(x.date).localeCompare(String(y.date)));
  let cost = rv.length ? Number(rv[0].oldCost) || 0 : Number(a.cost) || 0, accum = 0, imp = 0, adj = -(Number(a.priorAdjustment) || 0), qty = Number(a.qty) || 1;
  return ev.map(e => {
    if (e.kind === "baseline") accum = round2(Number(a.depBaseline.amount) || 0);
    if (e.kind === "revalue") cost = e.newCost;
    if (e.kind === "depreciation") accum = round2(accum + e.amount);
    if (e.kind === "impairment") imp = round2(imp + Math.abs(e.amount));
    if (e.kind === "adjustment") adj = round2(adj + e.amount);
    if (e.kind === "retire") qty = 0;
    if (e.kind === "reactivate") qty = Number(a.qty) || 1;
    return { ...e, cost, accum, impairment: imp, adjustment: e.kind === "adjustment" ? e.amount : 0, adjusted: round2(cost - accum - imp), sxAdjusted: round2(cost + adj - imp), qty, balanceQty: qty };
  });
}
/** Just the rows a Property Card shows (receipt, transfers, returns, revaluations, disposal). */
export const propertyCardRows = rows => rows.filter(r => ["acquire", "revalue", "transfer", "return", "retire", "reactivate"].includes(r.kind));

/** Global search over everything a staff user can see. Returns up to `limit` hits per kind. */
export function searchAll(q, d, fund, limit = 15) {
  const t = String(q || "").trim().toLowerCase();
  if (t.length < 2) return null;
  const has = (...v) => v.some(x => x != null && String(x).toLowerCase().includes(t));
  const inFund = x => !fund || x.fund === fund;
  return {
    assets: d.assets.filter(a => inFund(a) && has(a.propertyNo, a.description, a.specs, a.holder?.name, a.holder?.office, a.location, a.source?.number, a.dvNo, a.special?.roadId, a.special?.bldgId, a.special?.lotId)).slice(0, limit),
    airs: d.airs.filter(a => inFund(a) && a.status !== "draft" && has(a.airNo, a.supplier, a.office, a.poNo, a.invNo, ...(a.lines || []).map(l => l.description))).slice(0, limit),
    docs: d.docs.filter(x => inFund(x) && has(x.number, x.airNo, x.recipient?.name, x.recipient?.office, ...(x.lines || []).map(l => `${l.description} ${l.propertyNo} ${l.stockNo}`))).slice(0, limit),
    movements: d.movements.filter(x => inFund(x) && has(x.number, x.from?.name, x.to?.name, x.reason, x.ref, ...(x.lines || []).map(l => `${l.propertyNo} ${l.description}`))).slice(0, limit),
    repairs: d.repairs.filter(x => inFund(x) && has(x.jobOrderNo, x.propertyNo, x.description, x.makeModel, x.plateNo, x.unitSerialNo, x.engineSerialNo, x.supplier)).slice(0, limit),
    cip: d.cip.filter(x => inFund(x) && has(x.cipNo, x.name, x.contractor, x.location)).slice(0, limit)
  };
}

export { periodOf };
