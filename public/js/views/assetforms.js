// Register maintenance ported from PMS: add / correct an item (with the special fields of Land, Roads, Other
// Infrastructure, Buildings and Biological Assets), Accounting's Revalue, Ledger entry, Reclassify and Reactivate,
// PAR / ICS for register items, and the printed Ledger / Property Cards and QR ID tags.
import { S, can, settings, activeUsers } from "../state.js";
import { $, $$, esc, busy, toast, money, opts, accountOpts, openModal, officeSelect, manilaToday } from "../ui.js";
import { FUNDS, PPE_ACCOUNTS, SX_ACCOUNTS, fundName, accountName } from "../core/catalog.js";
import { defaultLife, hasPostedDepreciation } from "../core/assets.js";
import { specialGroup, SPECIAL_FIELDS, COMPONENTS, ACQUISITION_TYPES, assetTimeline } from "../core/cards.js";
import { round2, numberingFor } from "../core/logic.js";
import { addAsset, updateAsset, revalueAsset, addLedgerEntry, reclassifyAsset, reactivateAsset, issueForAssets } from "../data.js";
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

/** Add an item (a = null) or correct one. GSO and Accounting; cost, account and dates are Accounting's, and lock once depreciated. */
export function assetFormModal(a = null, preset = {}) {
  const add = !a, acct = can("post") || can("manageUsers"), gso = can("issue");
  const v = a || { fund: S.fund, itemType: preset.itemType || "ppe", qty: 1, unit: "", condition: "Serviceable", acquisition: { type: "purchased" } };
  const locked = !add && hasPostedDepreciation(a, S.d.depr);
  const moneyEditable = add || (acct && !locked);
  const users = activeUsers(), s = settings();
  const m = openModal(`<h2>${add ? "Add item to the register" : "Correct record"}</h2>
    <p class="muted small">${add ? "For property not coming through an AIR: found at the station, donated, or acquired before this system. Items received through an AIR are added when the GSO issues the PAR / ICS." :
      locked ? "Depreciation has been posted for this item, so its cost, account and dates are locked — use <b>Revalue</b> or <b>Reclassify</b> for dated changes." : acct ? "" : "Cost, account, fund and date acquired are corrected by Accounting."}</p>
    <form class="grid g3" id="af">
      ${add ? `<div><label class="req">Fund</label><select name="fund">${opts(FUNDS.map(f => [f.code, f.name]), v.fund)}</select></div>
        <div><label class="req">Kind</label><select name="itemType">${opts([["ppe", "Property, Plant and Equipment"], ["sx", "Semi-expendable"]], v.itemType)}</select></div>` : `<div><label>Fund</label><input disabled value="${esc(fundName(a.fund))}"></div><div><label>Kind</label><input disabled value="${a.itemType === "ppe" ? "PPE" : "Semi-expendable"}"></div>`}
      <div><label class="req">Account</label><select name="accountCode" ${moneyEditable ? "" : "disabled"}>${accountOpts(v.itemType === "sx" ? SX_ACCOUNTS : PPE_ACCOUNTS, v.accountCode)}</select></div>
      <div><label>${v.itemType === "sx" ? "Item No." : "Property No."}</label><input name="propertyNo" value="${esc(v.propertyNo || "")}"></div>
      <div><label>Article / type</label><input name="articleType" value="${esc(v.articleType || "")}" placeholder="e.g. Desktop computer"></div>
      <div><label>Unit</label><input name="unit" value="${esc(v.unit || "")}" placeholder="unit, set, lot"></div>
      <div class="spanall"><label class="req">Description</label><input name="description" value="${esc(v.description || "")}"></div>
      <div class="spanall"><label>Specifications</label><textarea name="specs" rows="2">${esc(v.specs || "")}</textarea></div>
      <div><label class="req">Quantity</label><input type="number" min="1" step="1" name="qty" value="${esc(v.qty || 1)}" ${add ? "" : "disabled"}></div>
      <div><label class="req">Total cost (₱)</label><input type="number" min="0" step="0.01" name="cost" value="${v.cost ?? ""}" ${moneyEditable ? "" : "disabled"}></div>
      <div><label class="req">Date acquired</label><input type="date" name="dateAcquired" value="${esc(v.dateAcquired || "")}" ${moneyEditable ? "" : "disabled"}></div>
      <div data-ppe><label>Useful life (years)</label><input type="number" min="0" step="1" name="usefulLifeYears" value="${v.usefulLifeYears ?? ""}" placeholder="from the account"></div>
      <div data-ppe><label>Residual value (₱)</label><input type="number" min="0" step="0.01" name="residualValue" value="${add ? "" : v.residualValue ?? ""}" placeholder="5% of cost (0 for infrastructure)"></div>
      <div data-sx><label>Estimated useful life</label><input name="estimatedLife" value="${esc(v.estimatedLife || "")}" placeholder="e.g. 3 years"></div>
      ${acct || add ? `<div data-ppe><label>Opening accumulated depreciation (₱)</label><input type="number" min="0" step="0.01" name="baseAmount" value="${v.depBaseline?.amount ?? ""}" ${moneyEditable ? "" : "disabled"}></div>
        <div data-ppe><label>… as of month</label><input type="month" name="basePeriod" value="${esc(v.depBaseline?.period || "")}" ${moneyEditable ? "" : "disabled"}><div class="xs muted">Depreciation continues the month after.</div></div>
        <div data-sx><label>Prior adjustment / write-down (₱)</label><input type="number" step="0.01" name="priorAdjustment" value="${v.priorAdjustment ?? ""}" ${acct ? "" : "disabled"}></div>` : ""}
      <div><label>Acquired by</label><select name="acquisitionType">${opts(ACQUISITION_TYPES, v.acquisition?.type || "purchased")}</select></div>
      <div><label>Donor / source</label><input name="acquisitionSource" value="${esc(v.acquisition?.source || "")}"></div>
      <div><label>DV No. / Accounting reference</label><input name="dvNo" value="${esc(v.dvNo || "")}"></div>
      ${add ? `<div><label>Accountable officer</label><input name="holderName" list="ulist2" autocomplete="off"></div><div><label>Position</label><input name="holderPosition"></div>
        <datalist id="ulist2">${users.map(u => `<option value="${esc(u.displayName)}">${esc(u.office)}</option>`).join("")}</datalist>` : ""}
      ${add || gso ? `<div><label>Office</label>${officeSelect("office", v.holder?.office || "", s.offices, { blank: "No office" })}</div>` : ""}
      <div><label>Location</label><input name="location" value="${esc(v.location || "")}"></div>
      <div><label>Condition</label><select name="condition">${opts(CONDITIONS, v.condition || "Serviceable")}</select></div>
      <div><label>Photo link</label><input name="photoUrl" value="${esc(v.photoUrl || "")}" placeholder="https://drive.google.com/…"></div>
      <div><label>Document link</label><input name="docUrl" value="${esc(v.docUrl || "")}" placeholder="https://…"></div>
      <div class="spanall"><label>Remarks</label><input name="remarks" value="${esc(v.remarks || "")}"></div>
      <div class="spanall grid g3" id="spc" style="margin:0">${specialSection(v.accountCode, v)}</div>
      ${add ? "" : `<div class="spanall"><label class="req">Reason for the correction</label><input name="note"></div>`}
      <div class="spanall form-msg err" id="am"></div>
      <div class="spanall modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">${add ? "Add item" : "Save"}</button></div></form>`, { size: "wide" });
  const f = $("#af", m);
  $("[data-x]", m).onclick = () => m.close();
  const kind = () => (f.itemType ? f.itemType.value : v.itemType);
  const sync = () => { $$("[data-ppe]", m).forEach(x => { x.hidden = kind() !== "ppe"; }); $$("[data-sx]", m).forEach(x => { x.hidden = kind() !== "sx"; }); };
  sync();
  f.itemType && f.itemType.addEventListener("change", () => { f.accountCode.innerHTML = accountOpts(kind() === "sx" ? SX_ACCOUNTS : PPE_ACCOUNTS, ""); $("#spc", m).innerHTML = ""; sync(); });
  f.accountCode.addEventListener("change", () => {
    const keep = {}; $$("#spc input", m).forEach(i => { keep[i.name] = i.value; });
    $("#spc", m).innerHTML = specialSection(f.accountCode.value, v);
    $$("#spc input", m).forEach(i => { if (keep[i.name]) i.value = keep[i.name]; });
    if (add && kind() === "ppe" && !f.usefulLifeYears.value) f.usefulLifeYears.placeholder = `${defaultLife(f.accountCode.value) || 0} (from the account)`;
  });
  if (f.holderName) f.holderName.addEventListener("change", () => { const u = users.find(x => x.displayName === f.holderName.value); if (u) { f.holderPosition.value = u.position || ""; if (f.office) f.office.value = u.office || ""; } });
  f.onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f).entries());
    const special = {}, components = {};
    for (const [k, val] of Object.entries(d)) { if (k.startsWith("sp_")) special[k.slice(3)] = val; if (k.startsWith("cp_") && val !== "") components[k.slice(3)] = Number(val); }
    const ppe = kind() === "ppe";
    const base = { ...d, special: Object.keys(special).length ? special : null, components: Object.keys(components).length ? components : null };
    if (ppe && (d.baseAmount !== undefined)) base.depBaseline = Number(d.baseAmount) > 0 ? { amount: Number(d.baseAmount), period: d.basePeriod } : null;
    $("#am", m).textContent = "";
    busy(e.submitter, async () => {
      try {
        if (add) {
          const uid = activeUsers().find(u => u.displayName === d.holderName)?.id || "";
          const id = await addAsset({ ...base, custodianUid: uid, unitCost: round2((Number(d.cost) || 0) / (Number(d.qty) || 1)) });
          m.close(); clean(); toast("Item added.", "ok"); location.hash = `#/assets/${id}`;
        } else {
          const patch = { ...base };
          delete patch.note; delete patch.baseAmount; delete patch.basePeriod;
          if (!moneyEditable) { delete patch.cost; delete patch.dateAcquired; delete patch.accountCode; delete patch.depBaseline; }
          if (!gso) delete patch.office;
          await updateAsset(a.id, patch, d.note);
          m.close(); clean(); toast("Record updated.", "ok");
        }
      } catch (err) { $("#am", m).textContent = err.message; throw err; }
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

/** PAR / ICS for items already in the register (imported or added by hand). */
export function registerIssueModal(assets) {
  if (!assets.length) return toast("Choose the items.", "err");
  if (new Set(assets.map(a => a.itemType)).size > 1 || new Set(assets.map(a => a.fund)).size > 1) return toast("Choose items of one kind (PPE or semi-expendable) and one fund.", "err");
  const has = assets.filter(a => a.parIcs?.number);
  if (has.length) return toast(`${has.length} item(s) already have a PAR / ICS — use a transfer (PTR / ITR) instead.`, "err");
  const s = settings(), users = activeUsers(), dt = assets[0].itemType === "ppe" ? "PAR" : "ICS";
  const m = simpleModal(`Issue ${dt} for ${assets.length} register item(s)`, `For property already in the register (imported from PMS or added by hand) that has no ${dt} yet. Total ${money(assets.reduce((t, a) => t + a.cost, 0))}.`,
    `<div><label class="req">Date</label><input type="date" name="date" value="${today()}"></div>
     ${numberingFor(S.settings, assets[0].itemType === "ppe" ? "par" : "ics").mode === "manual" ? `<div><label class="req">${dt} No.</label><input name="number" placeholder="as on the printed form"></div>` : "<div></div>"}
     <div><label class="req">Received by (end-user)</label><input name="name" list="ulist3" autocomplete="off" value="${esc(assets[0].holder?.name || "")}"></div>
     <div><label>Position</label><input name="position" value="${esc(assets[0].holder?.position || "")}"></div>
     <div class="spanall"><label>Office</label>${officeSelect("office", assets[0].holder?.office || "", s.offices)}</div>
     <datalist id="ulist3">${users.map(u => `<option value="${esc(u.displayName)}">${esc(u.office)}</option>`).join("")}</datalist>`, `Issue ${dt}`,
    async v => {
      const u = users.find(x => x.displayName === v.name);
      const out = await issueForAssets(assets.map(a => a.id), { date: v.date, number: v.number || "", recipient: { name: v.name, position: v.position || "", office: v.office || "", uid: u?.id || "" },
        issuedBy: { name: s.signatories.propertyCustodian, position: s.signatories.propertyCustodianPosition } });
      toast(`${out.docType.toUpperCase()} ${out.number} issued.`, "ok"); location.hash = `#/issuances/${out.id}`;
    });
  const f = $("#xf", m);
  f.name.addEventListener("change", () => { const u = users.find(x => x.displayName === f.name.value); if (u) { f.position.value = u.position || ""; f.office.value = u.office || ""; } });
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
