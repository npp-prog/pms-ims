// Property register: PPE and semi-expendable records, their movements (PTR / ITR, PRS / RRSP, disposals)
// and each record's property card with its depreciation.
import { S, can, settings, fundAssets, assetById, activeUsers, inRegistry, awaitingPosting, docById } from "../state.js";
import { officeSelect, $, $$, esc, busy, toast, money, num, qty, fmtDate, fmtDateTime, manilaToday, opts, renderTable, openModal, confirmBox, downloadCSV } from "../ui.js";
import { fundName, accountName, FUNDS } from "../core/catalog.js";
import { accumAsOf, isDepreciable, periodOf, monthlyRate, TRANSFER_TYPES, DISPOSAL_MODES, checkMovement, movementDocType, impairmentAsOf, adjustedCostAsOf } from "../core/assets.js";
import { round2, numberingFor } from "../core/logic.js";
import { saveMovement, cancelMovement, editMovementDetails } from "../data.js";
import { printForm, movementHtml, tableReportHtml } from "../print.js";
import { assetFormModal, revalueModal, ledgerEntryModal, reclassModal, reactivateModal, printCards, activityLog } from "./assetforms.js";
import { specialGroup, SPECIAL_FIELDS, COMPONENTS, ACQUISITION_TYPES } from "../core/cards.js";
import { repairsOf, printHistory } from "./repairs.js";
import { attachmentsCard, attachmentsOf } from "./attachments.js";

const clean = () => window.dispatchEvent(new Event("app:clean"));
const today = () => manilaToday();
const nowPeriod = () => periodOf(today());
const STATUS = { active: ["In use", "b-ok"], returned: ["Returned to GSO", "b-info"], disposed: ["Disposed", "b-dark"], cancelled: ["Cancelled", ""] };
const statusBadge = s => `<span class="badge ${STATUS[s]?.[1] || ""}">${esc(STATUS[s]?.[0] || s)}</span>`;
const DOC_NAMES = { ptr: "PTR", itr: "ITR", prs: "PRS", rrsp: "RRSP", dsp: "Disposal" };
const accum = (a, runs) => a.itemType === "ppe" ? accumAsOf(a, nowPeriod(), runs) : 0;

/* ---------------- registries ---------------- */
function registry(main, itemType) {
  const ppe = itemType === "ppe", runs = S.d.depr;
  const rows = fundAssets().filter(a => a.itemType === itemType && a.status !== "cancelled");
  const title = ppe ? "Property, Plant & Equipment" : "Semi-Expendable Property";
  const canMove = can("issue");
  main.innerHTML = `<div class="page-head"><div><h1>${title}</h1><p>Every ${ppe ? "PPE" : "semi-expendable"} record in the ${esc(fundName(S.fund))}: issued on a ${ppe ? "PAR" : "ICS"} and posted by Accounting, or brought in through Data Import.${canMove ? " Tick items held by one person to transfer, return or dispose of them." : ""}</p></div>
    <div class="btn-row">
      ${canMove ? `<button class="btn" data-mv="transfer" disabled>Transfer (${ppe ? "PTR" : "ITR"})</button><button class="btn" data-mv="return" disabled>Return (${ppe ? "PRS" : "RRSP"})</button><button class="btn danger" data-mv="dispose" disabled>Dispose</button>` : ""}</div></div>
    ${(() => { const w = awaitingPosting().filter(a => a.itemType === itemType); return w.length ? `<div class="notice info">${w.length} item${w.length === 1 ? "" : "s"} issued on ${ppe ? "PAR" : "ICS"} (${money(w.reduce((t, a) => t + a.cost, 0))}) ${w.length === 1 ? "is" : "are"} not in the registry yet — ${w.length === 1 ? "it enters" : "they enter"} once Accounting posts the ${ppe ? "PAR" : "ICS"}. ${can("post") ? `<a href="#/posting">Open For Posting</a>` : ""}</div>` : ""; })()}
    <div class="card" id="t"></div>
    <div class="btn-row end"><span class="small muted" style="align-self:center">Print the items listed (filters apply):</span><button class="btn sm" id="lc">Ledger Cards</button><button class="btn sm" id="pc">Property Cards</button><button class="btn sm" id="tg">ID tags (QR)</button><button class="btn sm" id="csv">CSV</button><button class="btn sm" id="pr">Register</button></div>`;
  const sel = new Set();
  const t = renderTable($("#t", main), {
    id: "assets-" + itemType, rows, pageSize: 50, defaultSort: 1,
    searchText: a => `${a.propertyNo} ${a.description} ${a.specs} ${a.holder?.name} ${a.holder?.office} ${a.location} ${a.source?.number}`,
    searchPlaceholder: "Property no., item, officer, office, PAR/ICS",
    filters: [
      { key: "s", label: "Status", options: [["onhand", "On hand"], ["active", "In use"], ["returned", "Returned to GSO"], ["disposed", "Disposed"]], value: "onhand", test: (a, v) => v === "onhand" ? ["active", "returned"].includes(a.status) : a.status === v },
      { key: "a", label: "Account", options: [...new Set(rows.map(a => a.accountCode))].sort().map(c => [c, `${c} ${accountName(c)}`]), test: (a, v) => a.accountCode === v },
      { key: "o", label: "Office", options: [...[...new Set(rows.map(a => a.holder?.office).filter(Boolean))].sort().map(x => [x, x]), ["__none", "No office"]],
        test: (a, v) => v === "__none" ? !String(a.holder?.office || "").trim() : a.holder?.office === v },
      { key: "ao", label: "Accountable Officer", options: [...[...new Set(rows.map(a => String(a.holder?.name || "").trim()).filter(Boolean))].sort().map(x => [x, x]), ["__none", "No officer"]],
        test: (a, v) => v === "__none" ? !String(a.holder?.name || "").trim() : String(a.holder?.name || "").trim() === v }
    ],
    columns: [
      ...(canMove ? [{ label: "", render: a => ["active", "returned"].includes(a.status) ? `<input type="checkbox" data-nodirty data-sel="${esc(a.id)}" ${sel.has(a.id) ? "checked" : ""}>` : "" }] : []),
      { label: ppe ? "Property No." : "Item No.", render: a => `<b>${esc(a.propertyNo || "—")}</b>${hasFiles(a) ? ` <span class="badge b-ok" title="Signed PAR / ICS or other attachments on file">Attached</span>` : ""}<div class="xs muted">${esc(sourceText(a))}</div>`, sort: a => a.propertyNo || "" },
      { label: "Description", render: a => `${esc(a.description)}<div class="xs muted">${esc(a.accountCode)} ${esc(accountName(a.accountCode))}</div>`, sort: a => a.description },
      { label: "Acquired", render: a => fmtDate(a.dateAcquired), sort: a => a.dateAcquired || "" },
      { label: "Qty", render: a => `${qty(a.qty)} ${esc(a.unit)}`, cls: "right" },
      { label: "Cost", render: a => money(a.cost), sort: a => a.cost, cls: "right", headCls: "right" },
      ...(ppe ? [{ label: "Carrying amount", render: a => money(a.cost - accum(a, runs)), sort: a => a.cost - accum(a, runs), cls: "right", headCls: "right" }] : []),
      { label: "Accountable officer", render: a => `${esc(a.holder?.name || "—")}<div class="xs muted">${esc(a.holder?.office || a.location || "")}</div>`, sort: a => a.holder?.name || "" },
      { label: "Status", render: a => statusBadge(a.status), sort: a => a.status }
    ],
    empty: `No ${ppe ? "PPE" : "semi-expendable"} records in this fund yet.`,
    footer: list => `<tr><td colspan="${canMove ? 5 : 4}" class="right">Total</td><td class="right">${money(list.reduce((s, a) => s + a.cost, 0))}</td>${ppe ? `<td class="right">${money(list.reduce((s, a) => s + a.cost - accum(a, runs), 0))}</td>` : ""}<td colspan="2"></td></tr>`,
    onRow: a => { location.hash = `#/assets/${a.id}`; }
  });
  const sync = () => $$("[data-mv]", main).forEach(b => { b.disabled = !sel.size; });
  $("#t", main).addEventListener("click", e => { const c = e.target.closest("[data-sel]"); if (!c) return; c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); sync(); });
  $$("[data-mv]", main).forEach(b => b.onclick = () => { const list = [...sel].map(assetById).filter(Boolean); movementModal(b.dataset.mv, list); });
  $("#lc", main).onclick = () => printCards(t.rows(), "ledger");
  $("#pc", main).onclick = () => printCards(t.rows(), "property");
  $("#tg", main).onclick = () => printCards(t.rows(), "tags");
  const headers = ["Fund", ppe ? "Property No." : "Item No.", "Description", "Account", "Date Acquired", "Qty", "Unit", "Cost", ...(ppe ? ["Residual", "Useful Life", "Accum. Depr.", "Carrying Amount"] : []), "Accountable Officer", "Office", "Status", "Source"];
  $("#csv", main).onclick = () => downloadCSV(`${ppe ? "PPE" : "SemiExpendable"}-${S.fund}-${today()}`, headers, t.rows().map(a => [a.fund, a.propertyNo, a.description, a.accountCode, a.dateAcquired, a.qty, a.unit, a.cost,
    ...(ppe ? [a.residualValue, a.usefulLifeYears, accum(a, runs), round2(a.cost - accum(a, runs))] : []), a.holder?.name, a.holder?.office, STATUS[a.status]?.[0], sourceText(a)]));
  $("#pr", main).onclick = () => printForm(tableReportHtml(ppe ? "REGISTER OF PROPERTY, PLANT AND EQUIPMENT" : "REGISTRY OF SEMI-EXPENDABLE PROPERTY ISSUED", `${fundName(S.fund)} · as of ${fmtDate(today())}`,
    [ppe ? "Property No." : "Item No.", "Description", "Account", "Acquired", "Qty", "Cost", ...(ppe ? ["Accum. Depr.", "Carrying"] : []), "Accountable Officer"],
    t.rows().map(a => [a.propertyNo, a.description, a.accountCode, fmtDate(a.dateAcquired), `${qty(a.qty)} ${a.unit}`, num(a.cost), ...(ppe ? [num(accum(a, runs)), num(a.cost - accum(a, runs))] : []), a.holder?.name || ""])), "landscape");
}
export function ppe(main) { registry(main, "ppe"); }
ppe.deps = ["r:assets", "r:docs", "r:depr", "r:attachments", "fund"];
export function sx(main) { registry(main, "sx"); }
sx.deps = ["r:assets", "r:docs", "r:attachments", "fund"];
/** The item, or the PAR / ICS it was issued on, has a document attached. */
const hasFiles = a => attachmentsOf([{ type: "asset", id: a.id }, ...[a.source?.docId, a.parIcs?.docId].filter(Boolean).map(id => ({ type: "issuance", id }))]).length > 0;

/* ---------------- End-User: my property ---------------- */
export function mine(main) {
  const office = S.account?.office || "";
  const rows = S.d.assets.filter(a => ["active", "returned"].includes(a.status));
  const isMine = a => a.custodianUid === S.user.uid;
  main.innerHTML = `<div class="page-head"><div><h1>Office Property</h1><p>PPE and semi-expendable property held by ${office ? `the <b>${esc(office)}</b>` : "your office"}, including what is under your own name. You can record repairs of items under your name; to return or transfer an item, coordinate with the GSO.</p></div></div>
    ${office ? "" : `<div class="notice warn">Your account has no office yet, so only property under your own name is shown. Ask an administrator to set your office.</div>`}
    <div class="card" id="t"></div>`;
  renderTable($("#t", main), {
    id: "mine", rows, pageSize: 50,
    searchText: a => `${a.propertyNo} ${a.description} ${a.holder?.name}`,
    searchPlaceholder: "Property no., item, accountable officer",
    filters: [{ key: "w", label: "Accountable officer", options: [["me", "Only mine"], ["others", "Others in my office"]], test: (a, v) => v === "me" ? isMine(a) : !isMine(a) },
      { key: "f", label: "Fund", options: FUNDS.map(f => [f.code, f.name]), test: (a, v) => a.fund === v }],
    columns: [
      { label: "Property / Item No.", render: a => `<b>${esc(a.propertyNo || "—")}</b>`, sort: a => a.propertyNo || "" },
      { label: "Description", render: a => `${esc(a.description)}<div class="xs muted">${a.itemType === "ppe" ? "PPE" : "Semi-expendable"} · ${esc(sourceText(a))}</div>${inRegistry(a) ? "" : `<span class="badge b-warn">Awaiting Accounting posting</span>`}`, sort: a => a.description },
      { label: "Accountable officer", render: a => isMine(a) ? `<b>You</b>` : esc(a.holder?.name || "—"), sort: a => isMine(a) ? "" : a.holder?.name || "" },
      { label: "Qty", render: a => `${qty(a.qty)} ${esc(a.unit)}`, cls: "right" },
      { label: "Cost", render: a => money(a.cost), sort: a => a.cost, cls: "right", headCls: "right" },
      { label: "Acquired", render: a => fmtDate(a.dateAcquired), sort: a => a.dateAcquired || "" },
      { label: "", render: a => `<div class="btn-row" style="min-width:150px">${isMine(a) ? `<a class="btn sm" href="#/repairs/new/${esc(a.id)}">Request repair</a><button class="btn sm" data-hor="${esc(a.id)}">Repair history</button>` : ""}<button class="btn sm" data-card="${esc(a.id)}">Print card</button></div>` }
    ],
    empty: "No property is recorded for your office yet.",
    footer: l => `<tr><td colspan="4" class="right">Total</td><td class="right">${money(l.reduce((t, a) => t + a.cost, 0))}</td><td colspan="2"></td></tr>`
  });
  $("#t", main).addEventListener("click", e => {
    const b = e.target.closest("[data-card]"); if (b) printCards([rows.find(a => a.id === b.dataset.card)], "property");
    const h = e.target.closest("[data-hor]"); if (h) printHistory(rows.find(a => a.id === h.dataset.hor));
  });
}
mine.deps = ["r:assets", "r:docs", "r:repairs"];

/* ---------------- asset page ---------------- */
function deprHistory(a, runs) {
  const out = []; let acc = a.depBaseline?.amount ? Number(a.depBaseline.amount) : 0;
  if (a.depBaseline?.period) out.push({ period: `${a.depBaseline.period} (opening)`, jevNo: "Imported from PMS", amount: acc, accum: round2(acc), carrying: round2(a.cost - acc) });
  for (const r of [...runs].sort((x, y) => x.period.localeCompare(y.period))) {
    const amt = r.amounts?.[a.id]; if (!amt) continue;
    acc = round2(acc + amt); out.push({ period: r.period, jevNo: r.jevNo, amount: amt, accum: acc, carrying: round2(a.cost - acc) });
  }
  return out;
}

export function detail(main, [id]) {
  const a = assetById(id);
  if (!a) { main.innerHTML = `<div class="notice warn">Record not found.</div>`; return; }
  const ppe = a.itemType === "ppe", runs = S.d.depr, per = nowPeriod();
  const dh = ppe ? deprHistory(a, runs) : [];
  const ad = ppe ? accumAsOf(a, per, runs) : 0, imp = impairmentAsOf(a, per);
  const registered = inRegistry(a), srcDoc = registered ? null : docById(a.source?.docId);
  const onHand = ["active", "returned"].includes(a.status) && registered, acct = can("post") && registered, gso = can("issue");
  const g = specialGroup(a.accountCode), log = activityLog(a);
  const link = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : "";
  main.innerHTML = `<div class="page-head"><div><h1>${esc(a.description)}</h1><p>${ppe ? "Property No." : "Item No."} ${esc(a.propertyNo || "—")} · ${esc(fundName(a.fund))} · ${ppe ? "PPE" : "Semi-expendable"}</p></div><div class="btn-row">${statusBadge(a.status)}</div></div>
    ${a.matchedTo ? (m => `<div class="notice info"><b>Matched to an item already in the registry.</b> When Accounting posted ${esc(a.source.kind.toUpperCase())} <a href="#/issuances/${esc(a.source.docId)}">${esc(a.source.number)}</a>, this line was matched to <a href="#/assets/${esc(a.matchedTo)}">${esc(m?.propertyNo || m?.description || "the registry item")}</a>, which now carries the ${esc(a.source.kind.toUpperCase())}; this record is set aside so nothing is counted twice.</div>`)(assetById(a.matchedTo)) : ""}
    ${registered ? "" : `<div class="notice warn"><b>Not in the registry yet.</b> This item was issued on ${esc(a.source.kind.toUpperCase())} <a href="#/issuances/${esc(a.source.docId)}">${esc(a.source.number)}</a>${srcDoc?.status === "cancelled" ? ", which was cancelled" : ""}; it enters the ${ppe ? "PPE" : "Semi-Expendable"} Registry once Accounting posts that ${esc(a.source.kind.toUpperCase())}. Until then it can't be transferred, returned, disposed of, revalued or depreciated.</div>`}
    <div class="card"><div class="btn-row">
      <button class="btn sm" id="lc">Print Ledger Card</button><button class="btn sm" id="pc">Print Property Card</button><button class="btn sm" id="tag">ID tag (QR)</button>
      ${(gso || acct) && a.status !== "cancelled" ? `<button class="btn sm" id="edit">Correct record</button>` : ""}
      ${gso && onHand ? `<button class="btn sm" data-mv="transfer">Transfer</button>${a.status === "active" ? `<button class="btn sm" data-mv="return">Return to GSO</button>` : ""}<button class="btn sm danger" data-mv="dispose">Dispose</button>` : ""}
      ${acct && a.status !== "cancelled" ? `${ppe && a.status !== "disposed" ? `<button class="btn sm" id="rv">Revalue</button>` : ""}<button class="btn sm" id="le">Ledger entry</button><button class="btn sm" id="rc">Reclassify</button>${a.status === "disposed" ? `<button class="btn sm" id="ra">Reactivate</button>` : ""}` : ""}
    </div></div>
    <div class="split"><div>
      ${log.length ? `<div class="card"><h3>Ledger changes</h3><div class="table-wrap"><table><thead><tr><th>Effective</th><th>Change</th><th>By</th></tr></thead>
        <tbody>${log.map(([d, t, by]) => `<tr><td>${fmtDate(d)}</td><td>${esc(t)}</td><td class="small">${esc(by || "")}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      ${ppe ? `<div class="card"><div class="card-head"><h3>Depreciation</h3><span class="small muted">${isDepreciable(a) ? `${money(monthlyRate(a))} a month` : "Not depreciated"}</span></div>
        ${dh.length ? `<div class="table-wrap"><table><thead><tr><th>Period</th><th>JEV No.</th><th class="right">Depreciation</th><th class="right">Accumulated</th><th class="right">Carrying amount</th></tr></thead>
        <tbody>${dh.map(r => `<tr><td>${esc(r.period)}</td><td>${esc(r.jevNo)}</td><td class="right">${num(r.amount)}</td><td class="right">${num(r.accum)}</td><td class="right">${num(r.carrying)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted small">No depreciation posted yet.</p>`}</div>` : ""}
      <div class="card"><div class="card-head"><h3>History of Repair</h3><span class="small muted">${money(repairsOf(a.id).reduce((t, r) => t + r.totalCost, 0))}</span></div>
        ${repairsOf(a.id).length ? `<div class="table-wrap"><table><thead><tr><th>JO date</th><th>Job Order No.</th><th>Nature / supplier</th><th class="right">Cost</th><th>Status</th></tr></thead>
        <tbody>${repairsOf(a.id).sort((x, y) => String(y.jobOrderDate).localeCompare(String(x.jobOrderDate))).map(r => `<tr class="click" onclick="location.hash='#/repairs/${esc(r.id)}'"><td>${fmtDate(r.jobOrderDate)}</td><td>${esc(r.jobOrderNo)}</td><td>${esc(r.nature || "—")}<div class="xs muted">${esc(r.supplier)}</div></td><td class="right">${num(r.totalCost)}</td><td>${esc(r.status)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted small">No repairs recorded.</p>`}
        <div class="btn-row" style="margin-top:.6rem">${onHand ? `<a class="btn sm" href="#/repairs/new/${esc(a.id)}">Record a repair</a>` : ""}<button class="btn sm" id="hor">Print History of Repair</button></div></div>
      <div id="att"></div>
      <div class="card"><h3>History</h3><ul class="timeline">${(a.history || []).slice().reverse().map(h => `<li class="done"><div>${esc(h.action)}${h.note ? ` — <i>${esc(h.note)}</i>` : ""}</div><div class="when">${fmtDateTime(h.at)} · ${esc(h.by)}</div></li>`).join("")}</ul></div>
    </div><div>
      <div class="card"><h3>Details</h3><dl class="kv">
        <dt>${ppe ? "Property No." : "Item No."}</dt><dd>${esc(a.propertyNo || "—")}</dd>
        <dt>Account</dt><dd>${esc(a.accountCode)} ${esc(accountName(a.accountCode))}</dd>
        ${a.articleType ? `<dt>Article / type</dt><dd>${esc(a.articleType)}</dd>` : ""}
        ${a.specs ? `<dt>Specifications</dt><dd>${esc(a.specs)}</dd>` : ""}
        <dt>Quantity</dt><dd>${qty(a.qty)} ${esc(a.unit)}</dd>
        <dt>Cost</dt><dd>${money(a.cost)}${(a.revaluations || []).length ? ` <span class="xs muted">(revalued)</span>` : ""}</dd>
        <dt>Date acquired</dt><dd>${fmtDate(a.dateAcquired)}</dd>
        ${ppe ? `<dt>Useful life</dt><dd>${esc(a.usefulLifeYears || 0)} years</dd><dt>Residual value</dt><dd>${money(a.residualValue)}</dd><dt>Accumulated depr.</dt><dd>${money(ad)}</dd>${imp ? `<dt>Impairment</dt><dd>${money(imp)}</dd>` : ""}<dt>Carrying amount</dt><dd><b>${money(a.cost - ad - imp)}</b></dd>`
          : `<dt>Est. useful life</dt><dd>${esc(a.estimatedLife || "—")}</dd>${(a.adjustments || []).length || a.priorAdjustment ? `<dt>Adjusted cost</dt><dd><b>${money(adjustedCostAsOf(a, per))}</b></dd>` : ""}`}
        <dt>Accountable officer</dt><dd>${esc(a.holder?.name || "—")}${a.holder?.office ? `<div class="xs muted">${esc(a.holder.office)}</div>` : ""}</dd>
        <dt>Location</dt><dd>${esc(a.location || "—")}</dd><dt>Condition</dt><dd>${esc(a.condition || "—")}</dd>
        <dt>Source</dt><dd>${sourceHtml(a)}</dd>
        ${a.parIcs?.number ? `<dt>${esc(a.parIcs.docType.toUpperCase())}</dt><dd><a href="#/issuances/${esc(a.parIcs.docId)}">${esc(a.parIcs.number)}</a></dd>` : ""}
        ${a.acquisition?.type && a.acquisition.type !== "purchased" ? `<dt>Acquired by</dt><dd>${esc((ACQUISITION_TYPES.find(x => x[0] === a.acquisition.type) || [])[1] || a.acquisition.type)}${a.acquisition.source ? ` — ${esc(a.acquisition.source)}` : ""}</dd>` : ""}
        ${a.dvNo ? `<dt>DV No.</dt><dd>${esc(a.dvNo)}</dd>` : ""}
        ${a.remarks ? `<dt>Remarks</dt><dd>${esc(a.remarks)}</dd>` : ""}
        ${a.photoUrl || a.docUrl ? `<dt>Files</dt><dd>${[link(a.photoUrl, "Photo"), link(a.docUrl, "Document")].filter(Boolean).join(" · ")}</dd>` : ""}
        ${g ? (SPECIAL_FIELDS[g] || []).filter(([k]) => a.special?.[k]).map(([k, l]) => `<dt>${esc(l)}</dt><dd>${esc(a.special[k])}</dd>`).join("") : ""}
        ${g && COMPONENTS[g] && a.components ? COMPONENTS[g].filter(([k]) => a.components[k] != null).map(([k, l]) => `<dt>${esc(l)}</dt><dd>${money(a.components[k])}</dd>`).join("") : ""}
        ${a.disposal ? `<dt>Disposal</dt><dd>${esc(a.disposal.reason)}${a.disposal.date ? ` · ${fmtDate(a.disposal.date)}` : ""}${a.disposal.ref ? ` · ${esc(a.disposal.ref)}` : ""}</dd>` : ""}
      </dl></div>
    </div></div>`;
  const docIds = [...new Set([["par", "ics"].includes(a.source?.kind) ? a.source.docId : "", a.parIcs?.docId].filter(Boolean))];
  const moves = S.d.movements.filter(x => (x.lines || []).some(l => l.assetId === a.id)).map(x => ({ type: "movement", id: x.id }));
  attachmentsCard($("#att", main), { type: "asset", id: a.id, office: a.holder?.office || "", fund: a.fund, label: a.propertyNo || a.description },
    { also: [...docIds.map(id => ({ type: "issuance", id })), ...moves], defaultLabel: ppe ? "Signed PAR" : "Signed ICS", title: "Signed PAR / ICS and other attachments" });
  $("#lc", main).onclick = () => printCards([a], "ledger");
  $("#pc", main).onclick = () => printCards([a], "property");
  $("#tag", main).onclick = () => printCards([a], "tags");
  $("#hor", main).onclick = () => printHistory(a);
  $$("[data-mv]", main).forEach(b => b.onclick = () => movementModal(b.dataset.mv, [a]));
  const on = (sel, fn) => { const b = $(sel, main); if (b) b.onclick = fn; };
  on("#edit", () => assetFormModal(a));
  on("#rv", () => revalueModal(a));
  on("#le", () => ledgerEntryModal(a));
  on("#rc", () => reclassModal(a));
  on("#ra", () => reactivateModal(a));
}
detail.deps = ["r:assets", "r:docs", "r:depr", "r:repairs", "r:movements", "r:attachments"];

function sourceHtml(a) {
  const k = a.source?.kind;
  if (k === "import") return "Imported from PMS";
  if (k === "manual") return `Added to the register${a.source.by ? ` by ${esc(a.source.by)}` : ""}`;
  if (k === "cip") return `<a href="#/cip/${esc(a.source.docId)}">CIP ${esc(a.source.number)}</a>`;
  return `<a href="#/issuances/${esc(a.source?.docId)}">${esc(k?.toUpperCase())} ${esc(a.source?.number)}</a> · ${a.source?.airId ? `<a href="#/airs/${esc(a.source.airId)}">AIR ${esc(a.source.airNo)}</a>` : "from PMS"}`;
}
const sourceText = a => ({ import: "Imported", manual: "Added to register", cip: `CIP ${a.source?.number || ""}` }[a.source?.kind] || `${a.source?.kind?.toUpperCase() || ""} ${a.source?.number || ""}`);

/* ---------------- transfer / return / dispose ---------------- */
function movementModal(kind, assets) {
  const err = checkMovement(assets, kind);
  if (err) return toast(err, "err");
  const s = settings(), sx = assets[0].itemType === "sx", runs = S.d.depr;
  const dt = movementDocType(kind, assets[0].itemType);
  const title = kind === "transfer" ? (sx ? "Inventory Transfer Report (ITR)" : "Property Transfer Report (PTR)") : kind === "return" ? (sx ? "Receipt of Returned Semi-Expendable Property (RRSP)" : "Property Return Slip (PRS)") : "Dispose of property";
  const carrying = a => a.itemType === "ppe" ? round2(a.cost - accumAsOf(a, nowPeriod(), runs)) : a.cost;
  const users = activeUsers();
  const m = openModal(`<h2>${esc(title)}</h2><p class="muted small">From <b>${esc(assets[0].holder?.name || "—")}</b>${assets[0].holder?.office ? ` · ${esc(assets[0].holder.office)}` : ""} · ${esc(fundName(assets[0].fund))}</p>
    <div class="table-wrap"><table class="lines"><thead><tr><th>Item</th><th class="right">Cost</th>${sx && kind !== "dispose" ? `<th class="right">Qty to ${kind}</th>` : ""}<th>Condition</th>${kind === "dispose" ? `<th class="right">Carrying amount</th>` : ""}</tr></thead>
    <tbody>${assets.map(a => `<tr data-id="${esc(a.id)}"><td><b>${esc(a.propertyNo || "—")}</b> ${esc(a.description)}</td><td class="right">${num(a.cost)}</td>
      ${sx && kind !== "dispose" ? `<td><input type="number" class="w-xs" data-q min="1" max="${a.qty}" step="1" value="${a.qty}"> / ${qty(a.qty)}</td>` : ""}
      <td><select data-c class="w-md">${opts(["Serviceable", "Needs repair", "Unserviceable"], kind === "dispose" ? "Unserviceable" : a.condition || "Serviceable")}</select></td>
      ${kind === "dispose" ? `<td class="right">${num(carrying(a))}</td>` : ""}</tr>`).join("")}</tbody></table></div>
    <form class="grid g2" id="mf" style="margin-top:1rem">
      <div><label class="req">Date</label><input type="date" name="date" value="${today()}"></div>
      ${numberingFor(S.settings, dt).mode === "manual" ? `<div><label class="req">${esc(DOC_NAMES[dt])} No.</label><input name="number" placeholder="as on the printed form"></div>` : ""}
      ${kind === "transfer" ? `<div><label>Transfer type</label><select name="transferType">${opts(TRANSFER_TYPES, "reassignment")}</select></div>
        <div><label class="req">To (accountable officer)</label><input name="toName" list="ulist" autocomplete="off"></div>
        <div><label>Position</label><input name="toPos"></div>
        <div><label>Office</label>${officeSelect("toOffice", "", s.offices)}</div>
        <div><label>Others — specify</label><input name="typeOther"></div>
        <datalist id="ulist">${users.map(u => `<option value="${esc(u.displayName)}">${esc(u.office)}</option>`).join("")}</datalist>
` : ""}
      ${kind === "dispose" ? `<div><label class="req">Mode of disposal</label><select name="mode">${opts(DISPOSAL_MODES, "", "Choose")}</select></div>
        <div class="spanall"><label>Reference (IIRUP no., sales invoice, police report…)</label><input name="ref"></div>` : ""}
      <div class="spanall"><label>${kind === "transfer" ? "Reason for transfer" : kind === "return" ? "Reason for return" : "Remarks"}</label><input name="reason"></div>
      ${kind !== "return" ? `<div><label>Approved by</label><input name="aName" value="${esc(s.signatories.approver)}"></div><div><label>Position</label><input name="aPos" value="${esc(s.signatories.approverPosition)}"></div>` : ""}
      <div class="spanall form-msg err" id="mm"></div>
      <div class="spanall modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn ${kind === "dispose" ? "danger solid" : "primary"}" type="submit">Save ${esc(DOC_NAMES[dt])}</button></div></form>`, { size: "wide" });
  $("[data-x]", m).onclick = () => m.close();
  const f = $("#mf", m);
  if (f.toName) f.toName.addEventListener("change", () => { const u = users.find(x => x.displayName === f.toName.value); if (u) { f.toPos.value = u.position || ""; f.toOffice.value = u.office || ""; } });
  f.onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    const lines = {};
    $$("tbody tr[data-id]", m).forEach(tr => { const a = assets.find(x => x.id === tr.dataset.id); lines[a.id] = { condition: $("[data-c]", tr).value, qty: $("[data-q]", tr) ? Number($("[data-q]", tr).value) : a.qty, carrying: carrying(a) }; });
    const u = users.find(x => x.displayName === v.toName);
    const h = { date: v.date, number: v.number || "", reason: v.reason || "", lines, transferType: v.transferType, typeOther: v.typeOther || "", mode: v.mode || "", ref: v.ref || "",
      to: kind === "transfer" ? { name: v.toName || "", position: v.toPos || "", office: v.toOffice || "", uid: u?.id || "" } : null,
      approvedBy: { name: v.aName || "", position: v.aPos || "" }, issuedBy: { name: s.signatories.propertyCustodian, position: s.signatories.propertyCustodianPosition } };
    $("#mm", m).textContent = "";
    busy(e.submitter, async () => {
      try { const out = await saveMovement(kind, assets.map(a => a.id), h); m.close(); clean(); toast(`${DOC_NAMES[out.docType]} ${out.number} saved.`, "ok"); location.hash = `#/movements/${out.id}`; }
      catch (err) { $("#mm", m).textContent = err.message; throw err; }
    }).catch(() => {});
  };
}

/* ---------------- movements list and detail ---------------- */
export function movements(main) {
  const rows = S.d.movements.filter(x => x.fund === S.fund);
  main.innerHTML = `<div class="page-head"><div><h1>Transfers, Returns &amp; Disposals</h1><p>PTR / ITR, PRS / RRSP and disposal reports in the ${esc(fundName(S.fund))}. Start one from the PPE or Semi-Expendable registry.</p></div></div><div class="card" id="t"></div>`;
  renderTable($("#t", main), {
    id: "movements", rows, pageSize: 50, defaultSort: 0, defaultDir: -1,
    searchText: x => `${x.number} ${x.from?.name} ${x.to?.name} ${x.lines.map(l => `${l.propertyNo} ${l.description}`).join(" ")}`,
    filters: [{ key: "t", label: "Type", options: Object.entries(DOC_NAMES), test: (x, v) => x.docType === v }],
    columns: [
      { label: "Date", render: x => fmtDate(x.date), sort: x => x.date },
      { label: "Document", render: x => `<b>${esc(DOC_NAMES[x.docType])} ${esc(x.number)}</b>${x.transferType === "donation" ? ` <span class="badge b-warn">Donation</span>` : ""}`, sort: x => x.docType + x.number },
      { label: "From → To", render: x => `${esc(x.from?.name || "—")} → ${esc(x.to?.name || (x.docType === "dsp" ? x.mode : "—"))}` },
      { label: "Items", render: x => x.lines.length, cls: "right" },
      { label: "Amount", render: x => money(x.total), cls: "right", headCls: "right", sort: x => x.total },
      { label: "Status", render: x => x.status === "cancelled" ? `<span class="badge b-dark">Cancelled</span>` : x.needsPosting ? (x.posting?.posted ? `<span class="badge b-ok">Posted</span>` : `<span class="badge b-warn">For posting</span>`) : `<span class="badge">Recorded</span>` }
    ],
    empty: "No transfers, returns or disposals yet.",
    onRow: x => { location.hash = `#/movements/${x.id}`; }
  });
}
movements.deps = ["r:movements", "fund"];

export function movement(main, [id]) {
  const x = S.d.movements.find(m => m.id === id);
  if (!x) { main.innerHTML = `<div class="notice warn">Document not found.</div>`; return; }
  main.innerHTML = `<div class="page-head"><div><h1>${esc(DOC_NAMES[x.docType])} ${esc(x.number)}</h1><p>${fmtDate(x.date)} · ${esc(fundName(x.fund))}</p></div>
      <div class="btn-row"><button class="btn primary" id="print">Print</button>${can("issue") && x.status !== "cancelled" ? `<button class="btn" id="ed">Edit printed details</button>` : ""}${can("issue") && x.needsPosting && x.status !== "cancelled" && !x.posting?.posted ? `<button class="btn danger" id="cancel">Cancel</button>` : ""}</div></div>
    ${x.status === "cancelled" ? `<div class="notice bad">Cancelled — ${esc(x.cancel?.reason)}</div>` : ""}
    <div class="card"><dl class="kv"><dt>From</dt><dd>${esc(x.from?.name || "—")} ${esc(x.from?.office ? "· " + x.from.office : "")}</dd>
      ${x.to ? `<dt>To</dt><dd>${esc(x.to.name)} ${esc(x.to.office ? "· " + x.to.office : "")}</dd>` : ""}
      ${x.transferType ? `<dt>Transfer type</dt><dd>${esc(x.transferType)}${x.typeOther ? ` — ${esc(x.typeOther)}` : ""}</dd>` : ""}
      ${x.mode ? `<dt>Mode</dt><dd>${esc(x.mode)}${x.ref ? ` · ${esc(x.ref)}` : ""}</dd>` : ""}
      ${x.reason ? `<dt>Reason</dt><dd>${esc(x.reason)}</dd>` : ""}
      ${x.needsPosting ? `<dt>Accounting</dt><dd>${x.posting?.posted ? `Posted · ${esc(x.posting.ref)} · ${fmtDate(x.posting.date)}` : "Not yet posted"}</dd>` : ""}</dl></div>
    <div id="att"></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Property / Item No.</th><th>Description</th><th class="right">Qty</th><th class="right">Cost</th>${x.docType === "dsp" ? `<th class="right">Carrying</th>` : ""}<th>Condition</th></tr></thead>
      <tbody>${x.lines.map(l => `<tr class="click" onclick="location.hash='#/assets/${esc(l.assetId)}'"><td>${esc(l.propertyNo || "—")}</td><td>${esc(l.description)}</td><td class="right">${qty(l.qty)}</td><td class="right">${num(l.amount)}</td>${x.docType === "dsp" ? `<td class="right">${num(l.carrying)}</td>` : ""}<td>${esc(l.condition)}</td></tr>`).join("")}</tbody></table></div></div>`;
  attachmentsCard($("#att", main), { type: "movement", id: x.id, office: x.to?.office || x.from?.office || "", fund: x.fund, label: `${DOC_NAMES[x.docType]} ${x.number}` },
    { defaultLabel: { ptr: "Signed PTR / ITR", itr: "Signed PTR / ITR", prs: "Signed PRS / RRSP", rrsp: "Signed PRS / RRSP", dsp: "Disposal / IIRUP document" }[x.docType], title: `Signed ${DOC_NAMES[x.docType]} and other attachments` });
  $("#print", main).onclick = () => printForm(movementHtml(x), x.docType === "dsp" ? "landscape" : "portrait");
  $("#ed", main) && ($("#ed", main).onclick = () => {
    const m = openModal(`<h2>Edit printed details</h2><p class="muted small">Signatories, reason and reference as they print on the ${esc(DOC_NAMES[x.docType])}. The items and their custody don't change.</p>
      <form class="grid g2" id="ef">
        <div class="spanall"><label>${x.docType === "dsp" ? "Remarks" : "Reason"}</label><input name="reason" value="${esc(x.reason || "")}"></div>
        ${x.transferType === "others" ? `<div class="spanall"><label>Transfer type — specify</label><input name="typeOther" value="${esc(x.typeOther || "")}"></div>` : ""}
        ${x.docType === "dsp" ? `<div class="spanall"><label>Reference</label><input name="ref" value="${esc(x.ref || "")}"></div>` : ""}
        <div><label>Approved by</label><input name="aName" value="${esc(x.approvedBy?.name || "")}"></div><div><label>Position</label><input name="aPos" value="${esc(x.approvedBy?.position || "")}"></div>
        <div><label>Released / issued by</label><input name="iName" value="${esc(x.issuedBy?.name || "")}"></div><div><label>Position</label><input name="iPos" value="${esc(x.issuedBy?.position || "")}"></div>
        <div class="spanall modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, { size: "narrow" });
    $("[data-x]", m).onclick = () => m.close();
    $("#ef", m).onsubmit = e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target).entries());
      busy(e.submitter, async () => { await editMovementDetails(x.id, { reason: v.reason, ref: v.ref ?? x.ref, typeOther: v.typeOther ?? x.typeOther, approvedBy: { name: v.aName, position: v.aPos }, issuedBy: { name: v.iName, position: v.iPos } }); m.close(); clean(); }, "Saved.").catch(() => {});
    };
  });
  $("#cancel", main) && ($("#cancel", main).onclick = async e => {
    const v = await confirmBox({ title: `Cancel ${DOC_NAMES[x.docType]} ${x.number}?`, body: "The items return to how they were before.", fields: [{ name: "reason", label: "Reason", type: "textarea", required: true }], confirmText: "Cancel it", danger: true });
    if (v) busy(e.target, () => cancelMovement(x.id, v.reason), "Cancelled.").catch(() => {});
  });
}
movement.deps = ["r:movements", "r:attachments"];

