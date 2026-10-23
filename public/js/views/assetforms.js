// Register maintenance ported from PMS: correct an item (with the special fields of Land, Roads, Other Infrastructure,
// Buildings and Biological Assets), Accounting's Revalue, Ledger entry, Reclassify and Reactivate, and the printed
// Ledger / Property Cards and QR ID tags. Items enter the register only from a PAR / ICS or through Data Import.
import { S, can, settings } from "../state.js";
import { $, $$, esc, busy, toast, money, opts, accountOpts, openModal, officeSelect, manilaToday } from "../ui.js";
import { FUNDS, PPE_ACCOUNTS, SX_ACCOUNTS, fundName, accountName } from "../core/catalog.js";
import { hasPostedDepreciation } from "../core/assets.js";
import { specialGroup, SPECIAL_FIELDS, COMPONENTS, ACQUISITION_TYPES, assetTimeline } from "../core/cards.js";
import { updateAsset, revalueAsset, addLedgerEntry, reclassifyAsset, reactivateAsset } from "../data.js";
import { printForm, ledgerCardHtml, propertyCardHtml, idTagsHtml } from "../print.js";

const clean = () => window.dispatchEvent(new Event("app:clean"));
const today = () => manilaToday();
const CONDITIONS = ["Serviceable", "Needs repair", "Unserviceable"];

/* ---------------- printed cards and tags ---------------- */
export const cardRows = a => assetTimeline(a, { runs: S.d.depr, movements: S.d.movements, repairs: S.d.repairs });
const assetUrl = a => `${location.origin}${location.pathname}#/assets/${a.id}`;
/** which: "ledger" | "property" | "tags" */
export function printCards(assets, which) {
  const list = (assets || []).filter(Boolean);
  if (!list.length) return toast("No items to print.", "err");
  if (which === "tags") return printForm(idTagsHtml(list.map(a => ({ a, url: assetUrl(a) }))), "tags");
  if (list.length > 300) toast(`Printing ${list.length} cards — this can take a moment.`);
  printForm(list.map(a => (which === "ledger" ? ledgerCardHtml : propertyCardHtml)(a, cardRows(a))).join(""), "landscape");
}

/* ---------------- add / correct ---------------- */
function specialSection(code, a = {}) {
  const g = specialGroup(code);
  if (!g) return "";
  const sp = a.special || {}, cp = a.components || {};
  const fields = (SPECIAL_FIELDS[g] || []).map(([k, l]) => `<div${k === "technicalDesc" || k === "otherDesc" ? ` class="spanall"` : ""}><label>${esc(l)}</label><input name="sp_${k}" value="${esc(sp[k] || "")}"></div>`).join("");
  const comps = COMPONENTS[g] ? `<div class="spanall xs muted">Cost by component (optional — printed on the ${g === "road" ? "Road Network" : g === "buildings" ? "Buildings" : "Infrastructure"} card${g === "road" ? "; the Road Lot value is land and is never depreciated, so it becomes the residual value" : ""}).</div>
    ${COMPONENTS[g].map(([k, l]) => `<div><label>${esc(l)}</label><input type="number" min="0" step="0.01" name="cp_${k}" value="${cp[k] ?? ""}"></div>`).join("")}` : "";
  return `<div class="spanall"><h3 style="margin:.6rem 0 0">${esc({ land: "Land", road: "Local Road Network", otherinfra: "Other Public Infrastructure", buildings: "Buildings and Structures", biological: "Biological Assets" }[g])} card details</h3></div>${fields}${comps}`;
}

/** Correct a register item. GSO and Accounting; cost, account and dates are Accounting's, and lock once depreciated.
 *  (Items come into the register only from a PAR / ICS or through Data Import.) */
export function assetFormModal(a) {
  const acct = can("post") || can("manageUsers"), gso = can("issue");
  const locked = hasPostedDepreciation(a, S.d.depr), moneyEditable = acct && !locked, s = settings();
  const m = openModal(`<h2>Correct record</h2>
    <p class="muted small">${locked ? "Depreciation has been posted for this item, so its cost, account and dates are locked — use <b>Revalue</b> or <b>Reclassify</b> for dated changes." : acct ? "" : "Cost, account, fund and date acquired are corrected by Accounting."}</p>
    <form class="grid g3" id="af">
      <div><label>Fund</label><input disabled value="${esc(fundName(a.fund))}"></div><div><label>Kind</label><input disabled value="${a.itemType === "ppe" ? "PPE" : "Semi-expendable"}"></div>
      <div><label class="req">Account</label><select name="accountCode" ${moneyEditable ? "" : "disabled"}>${accountOpts(a.itemType === "sx" ? SX_ACCOUNTS : PPE_ACCOUNTS, a.accountCode)}</select></div>
      <div><label>${a.itemType === "sx" ? "Item No." : "Property No."}</label><input name="propertyNo" value="${esc(a.propertyNo || "")}"></div>
      <div><label>Article / type</label><input name="articleType" value="${esc(a.articleType || "")}" placeholder="e.g. Desktop computer"></div>
      <div><label>Unit</label><input name="unit" value="${esc(a.unit || "")}" placeholder="unit, set, lot"></div>
      <div class="spanall"><label class="req">Description</label><input name="description" value="${esc(a.description || "")}"></div>
      <div class="spanall"><label>Specifications</label><textarea name="specs" rows="2">${esc(a.specs || "")}</textarea></div>
      <div><label>Quantity</label><input type="number" value="${esc(a.qty || 1)}" disabled></div>
      <div><label class="req">Total cost (₱)</label><input type="number" min="0" step="0.01" name="cost" value="${a.cost ?? ""}" ${moneyEditable ? "" : "disabled"}></div>
      <div><label class="req">Date acquired</label><input type="date" name="dateAcquired" value="${esc(a.dateAcquired || "")}" ${moneyEditable ? "" : "disabled"}></div>
      ${a.itemType === "ppe" ? `<div><label>Useful life (years)</label><input type="number" min="0" step="1" name="usefulLifeYears" value="${a.usefulLifeYears ?? ""}"></div>
        <div><label>Residual value (₱)</label><input type="number" min="0" step="0.01" name="residualValue" value="${a.residualValue ?? ""}"></div>
        ${acct ? `<div><label>Opening accumulated depreciation (₱)</label><input type="number" min="0" step="0.01" name="baseAmount" value="${a.depBaseline?.amount ?? ""}" ${moneyEditable ? "" : "disabled"}></div>
          <div><label>… as of month</label><input type="month" name="basePeriod" value="${esc(a.depBaseline?.period || "")}" ${moneyEditable ? "" : "disabled"}><div class="xs muted">Depreciation continues the month after.</div></div>` : ""}`
      : `<div><label>Estimated useful life</label><input name="estimatedLife" value="${esc(a.estimatedLife || "")}" placeholder="e.g. 3 years"></div>
        ${acct ? `<div><label>Prior adjustment / write-down (₱)</label><input type="number" step="0.01" name="priorAdjustment" value="${a.priorAdjustment ?? ""}"></div>` : ""}`}
      <div><label>Acquired by</label><select name="acquisitionType">${opts(ACQUISITION_TYPES, a.acquisition?.type || "purchased")}</select></div>
      <div><label>Donor / source</label><input name="acquisitionSource" value="${esc(a.acquisition?.source || "")}"></div>
      <div><label>DV No. / Accounting reference</label><input name="dvNo" value="${esc(a.dvNo || "")}"></div>
      ${gso ? `<div><label>Office</label>${officeSelect("office", a.holder?.office || "", s.offices, { blank: "No office" })}</div>` : ""}
      <div><label>Location</label><input name="location" value="${esc(a.location || "")}"></div>
      <div><label>Condition</label><select name="condition">${opts(CONDITIONS, a.condition || "Serviceable")}</select></div>
      <div><label>Photo link</label><input name="photoUrl" value="${esc(a.photoUrl || "")}" placeholder="https://drive.google.com/…"></div>
      <div><label>Document link</label><input name="docUrl" value="${esc(a.docUrl || "")}" placeholder="https://…"></div>
      <div class="spanall"><label>Remarks</label><input name="remarks" value="${esc(a.remarks || "")}"></div>
      <div class="spanall grid g3" id="spc" style="margin:0">${specialSection(a.accountCode, a)}</div>
      <div class="spanall"><label class="req">Reason for the correction</label><input name="note"></div>
      <div class="spanall form-msg err" id="am"></div>
      <div class="spanall modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, { size: "wide" });
  const f = $("#af", m);
  $("[data-x]", m).onclick = () => m.close();
  f.accountCode.addEventListener("change", () => {
    const keep = {}; $$("#spc input", m).forEach(i => { keep[i.name] = i.value; });
    $("#spc", m).innerHTML = specialSection(f.accountCode.value, a);
    $$("#spc input", m).forEach(i => { if (keep[i.name]) i.value = keep[i.name]; });
  });
  f.onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f).entries());
    const special = {}, components = {};
    for (const [k, val] of Object.entries(d)) { if (k.startsWith("sp_")) special[k.slice(3)] = val; if (k.startsWith("cp_") && val !== "") components[k.slice(3)] = Number(val); }
    const patch = { ...d, special: Object.keys(special).length ? special : null, components: Object.keys(components).length ? components : null };
    if (a.itemType === "ppe" && d.baseAmount !== undefined) patch.depBaseline = Number(d.baseAmount) > 0 ? { amount: Number(d.baseAmount), period: d.basePeriod } : null;
    for (const k of ["note", "baseAmount", "basePeriod", ...Object.keys(d).filter(k => /^(sp|cp)_/.test(k))]) delete patch[k];
    if (!moneyEditable) { delete patch.cost; delete patch.dateAcquired; delete patch.accountCode; delete patch.depBaseline; }
    $("#am", m).textContent = "";
    busy(e.submitter, async () => {
      try { await updateAsset(a.id, patch, d.note); m.close(); clean(); toast("Record updated.", "ok"); }
      catch (err) { $("#am", m).textContent = err.message; throw err; }
    }).catch(() => {});
  };
}

/* ---------------- Accounting actions ---------------- */
function simpleModal(title, intro, body, submitText, onSubmit, danger = false) {
  const m = openModal(`<h2>${esc(title)}</h2>${intro ? `<p class="muted small">${intro}</p>` : ""}<form class="grid g2" id="xf">${body}
    <div class="spanall form-msg err" id="xm"></div>
    <div class="spanall modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn ${danger ? "danger solid" : "primary"}" type="submit">${esc(submitText)}</button></div></form>`, { size: "narrow" });
  $("[data-x]", m).onclick = () => m.close();
  $("#xf", m).onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    $("#xm", m).textContent = "";
    busy(e.submitter, async () => { try { await onSubmit(v); m.close(); clean(); } catch (err) { $("#xm", m).textContent = err.message; throw err; } }).catch(() => {});
  };
  return m;
}

export function revalueModal(a) {
  simpleModal("Revalue", `Use this when a new appraisal or zonal valuation changes what <b>${esc(a.description)}</b> is worth. The new value applies from the effective date; the old one stays on the card. Current cost ${money(a.cost)}, residual ${money(a.residualValue)}.`,
    `<div><label class="req">New value (₱)</label><input type="number" min="0" step="0.01" name="newCost" value="${a.cost}"></div>
     <div><label>New residual value (₱)</label><input type="number" min="0" step="0.01" name="newResidual" value="${a.residualValue || 0}"></div>
     <div><label class="req">Effective date</label><input type="date" name="date" value="${today()}"></div><div><label>Reference</label><input name="ref" placeholder="Appraisal report no."></div>
     <div class="spanall"><label class="req">Reason</label><input name="reason"></div>`, "Revalue", v => revalueAsset(a.id, v).then(() => toast("Revalued.", "ok")));
}

export function ledgerEntryModal(a) {
  simpleModal("Ledger entry", `An adjustment writes the cost up or down (a negative amount lowers it); an impairment loss lowers the carrying amount. Both print on the Ledger Card. Repairs are recorded in History of Repair.`,
    `<div><label class="req">Type</label><select name="type">${opts([["adjustment", "Adjustment (write-up / write-down)"], ["impairment", "Impairment loss"]], "adjustment")}</select></div>
     <div><label class="req">Date</label><input type="date" name="date" value="${today()}"></div>
     <div><label class="req">Amount (₱)</label><input type="number" step="0.01" name="amount"></div><div><label>Reference (JEV no.)</label><input name="ref"></div>
     <div class="spanall"><label>Note</label><input name="note"></div>`, "Add entry", v => addLedgerEntry(a.id, v).then(() => toast("Entry added.", "ok")));
}

export function reclassModal(a) {
  const rows = a.itemType === "sx" ? SX_ACCOUNTS : PPE_ACCOUNTS;
  simpleModal("Reclassify", `Moves the item to another account and/or fund from the effective date. Depreciation and the reconciliation follow the account and fund in effect each month.`,
    `<div class="spanall"><label>Account</label><select name="accountCode">${accountOpts(rows, a.accountCode)}</select></div>
     <div><label>Fund</label><select name="fund">${opts(FUNDS.map(f => [f.code, f.name]), a.fund)}</select></div>
     <div><label class="req">Effective date</label><input type="date" name="date" value="${today()}"></div>
     <div class="spanall"><label class="req">Reason</label><input name="reason"></div>`, "Reclassify", v => reclassifyAsset(a.id, v).then(() => toast("Reclassified.", "ok")));
}

export function reactivateModal(a) {
  simpleModal("Reactivate", `Brings <b>${esc(a.description)}</b> back as in use (disposed by mistake, or found again). The disposal stays on the record and on the card.`,
    `<div><label class="req">Date</label><input type="date" name="date" value="${today()}"></div><div></div>
     <div class="spanall"><label class="req">Reason</label><input name="reason"></div>`, "Reactivate", v => reactivateAsset(a.id, v).then(() => toast("Reactivated.", "ok")));
}

/** Plain-language log of every dated change (PMS activity history), newest first. */
export function activityLog(a) {
  const ev = [];
  for (const r of a.revaluations || []) ev.push([r.date, `${r.kind === "addition" ? "Addition" : "Revalued"}: ${money(r.oldCost)} → ${money(r.newCost)}${r.oldResidual !== r.newResidual ? ` (residual ${money(r.oldResidual)} → ${money(r.newResidual)})` : ""}${r.reason ? ` — ${r.reason}` : ""}`, r.by]);
  for (const e of a.adjustments || []) ev.push([e.date, `${e.type === "impairment" ? "Impairment loss" : "Adjustment"} ${money(e.amount)}${e.note ? ` — ${e.note}` : ""}${e.ref ? ` (${e.ref})` : ""}`, e.by]);
  for (const c of a.accountChanges || []) ev.push([c.date, `Account ${c.oldCode} ${accountName(c.oldCode)} → ${c.newCode} ${accountName(c.newCode)}${c.reason ? ` — ${c.reason}` : ""}`, c.by]);
  for (const c of a.fundChanges || []) ev.push([c.date, `Fund ${fundName(c.oldFund)} → ${fundName(c.newFund)}${c.reason ? ` — ${c.reason}` : ""}`, c.by]);
  for (const r of a.reactivations || []) ev.push([r.date, `Reactivated${r.previousDisposal ? ` (was disposed: ${r.previousDisposal.reason || ""} ${r.previousDisposal.date || ""})` : ""} — ${r.reason}`, r.by]);
  return ev.sort((x, y) => String(y[0]).localeCompare(String(x[0])));
}
