// Property register: PPE and semi-expendable records, their movements (PTR / ITR, PRS / RRSP, disposals)
// and each record's property card with its depreciation.
import { S, can, settings, fundAssets, fundRuns, assetById, activeUsers } from "../state.js";
import { $, $$, esc, busy, toast, money, num, qty, fmtDate, fmtDateTime, manilaToday, opts, renderTable, openModal, confirmBox, downloadCSV } from "../ui.js";
import { fundName, accountName, FUNDS } from "../core/catalog.js";
import { accumAsOf, isDepreciable, periodOf, monthlyRate, TRANSFER_TYPES, DISPOSAL_MODES, checkMovement, movementDocType } from "../core/assets.js";
import { round2 } from "../core/logic.js";
import { saveMovement, cancelMovement, updateAsset } from "../data.js";
import { printForm, movementHtml, propertyCardHtml, tableReportHtml } from "../print.js";

const clean = () => window.dispatchEvent(new Event("app:clean"));
const today = () => manilaToday();
const nowPeriod = () => periodOf(today());
const STATUS = { active: ["In use", "b-ok"], returned: ["Returned to GSO", "b-info"], disposed: ["Disposed", "b-dark"], cancelled: ["Cancelled", ""] };
const statusBadge = s => `<span class="badge ${STATUS[s]?.[1] || ""}">${esc(STATUS[s]?.[0] || s)}</span>`;
const DOC_NAMES = { ptr: "PTR", itr: "ITR", prs: "PRS", rrsp: "RRSP", dsp: "Disposal" };
const accum = (a, runs) => a.itemType === "ppe" ? accumAsOf(a, nowPeriod(), runs) : 0;

/* ---------------- registries ---------------- */
function registry(main, itemType) {
  const ppe = itemType === "ppe", runs = fundRuns();
  const rows = fundAssets().filter(a => a.itemType === itemType && a.status !== "cancelled");
  const title = ppe ? "Property, Plant & Equipment" : "Semi-Expendable Property";
  const canMove = can("issue");
  main.innerHTML = `<div class="page-head"><div><h1>${title}</h1><p>Every ${ppe ? "PPE" : "semi-expendable"} record in the ${esc(fundName(S.fund))}: issued on a ${ppe ? "PAR" : "ICS"} or imported from PMS.${canMove ? " Tick items held by one person to transfer, return or dispose of them." : ""}</p></div>
    <div class="btn-row">${canMove ? `<button class="btn" data-mv="transfer" disabled>Transfer (${ppe ? "PTR" : "ITR"})</button><button class="btn" data-mv="return" disabled>Return (${ppe ? "PRS" : "RRSP"})</button><button class="btn danger" data-mv="dispose" disabled>Dispose</button>` : ""}
      <button class="btn" id="csv">CSV</button><button class="btn" id="pr">Print</button></div></div><div class="card" id="t"></div>`;
  const sel = new Set();
  const t = renderTable($("#t", main), {
    id: "assets-" + itemType, rows, pageSize: 50, defaultSort: 1,
    searchText: a => `${a.propertyNo} ${a.description} ${a.specs} ${a.holder?.name} ${a.holder?.office} ${a.location} ${a.source?.number}`,
    searchPlaceholder: "Property no., item, officer, office, PAR/ICS",
    filters: [
      { key: "s", label: "Status", options: [["onhand", "On hand"], ["active", "In use"], ["returned", "Returned to GSO"], ["disposed", "Disposed"]], value: "onhand", test: (a, v) => v === "onhand" ? ["active", "returned"].includes(a.status) : a.status === v },
      { key: "a", label: "Account", options: [...new Set(rows.map(a => a.accountCode))].sort().map(c => [c, `${c} ${accountName(c)}`]), test: (a, v) => a.accountCode === v }
    ],
    columns: [
      ...(canMove ? [{ label: "", render: a => ["active", "returned"].includes(a.status) ? `<input type="checkbox" data-nodirty data-sel="${esc(a.id)}" ${sel.has(a.id) ? "checked" : ""}>` : "" }] : []),
      { label: ppe ? "Property No." : "Item No.", render: a => `<b>${esc(a.propertyNo || "—")}</b><div class="xs muted">${esc(a.source?.kind === "import" ? "Imported" : `${a.source?.kind?.toUpperCase()} ${a.source?.number}`)}</div>`, sort: a => a.propertyNo || "" },
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
  $$("[data-mv]", main).forEach(b => b.onclick = () => movementModal(b.dataset.mv, [...sel].map(assetById).filter(Boolean)));
  const headers = ["Fund", ppe ? "Property No." : "Item No.", "Description", "Account", "Date Acquired", "Qty", "Unit", "Cost", ...(ppe ? ["Residual", "Useful Life", "Accum. Depr.", "Carrying Amount"] : []), "Accountable Officer", "Office", "Status", "Source"];
  $("#csv", main).onclick = () => downloadCSV(`${ppe ? "PPE" : "SemiExpendable"}-${S.fund}-${today()}`, headers, t.rows().map(a => [a.fund, a.propertyNo, a.description, a.accountCode, a.dateAcquired, a.qty, a.unit, a.cost,
    ...(ppe ? [a.residualValue, a.usefulLifeYears, accum(a, runs), round2(a.cost - accum(a, runs))] : []), a.holder?.name, a.holder?.office, STATUS[a.status]?.[0], a.source?.kind === "import" ? "Imported" : `${a.source?.kind} ${a.source?.number}`]));
  $("#pr", main).onclick = () => printForm(tableReportHtml(ppe ? "REGISTER OF PROPERTY, PLANT AND EQUIPMENT" : "REGISTRY OF SEMI-EXPENDABLE PROPERTY ISSUED", `${fundName(S.fund)} · as of ${fmtDate(today())}`,
    [ppe ? "Property No." : "Item No.", "Description", "Account", "Acquired", "Qty", "Cost", ...(ppe ? ["Accum. Depr.", "Carrying"] : []), "Accountable Officer"],
    t.rows().map(a => [a.propertyNo, a.description, a.accountCode, fmtDate(a.dateAcquired), `${qty(a.qty)} ${a.unit}`, num(a.cost), ...(ppe ? [num(accum(a, runs)), num(a.cost - accum(a, runs))] : []), a.holder?.name || ""])), "landscape");
}
export function ppe(main) { registry(main, "ppe"); }
ppe.deps = ["r:assets", "r:depr", "fund"];
export function sx(main) { registry(main, "sx"); }
sx.deps = ["r:assets", "fund"];

/* ---------------- End-User: my property ---------------- */
export function mine(main) {
  const rows = S.d.assets.filter(a => ["active", "returned"].includes(a.status));
  main.innerHTML = `<div class="page-head"><div><h1>My Property</h1><p>PPE and semi-expendable property under your accountability. To return or transfer an item, coordinate with the GSO.</p></div></div><div class="card" id="t"></div>`;
  renderTable($("#t", main), {
    id: "mine", rows, pageSize: 50,
    searchText: a => `${a.propertyNo} ${a.description}`,
    filters: [{ key: "f", label: "Fund", options: FUNDS.map(f => [f.code, f.name]), test: (a, v) => a.fund === v }],
    columns: [
      { label: "Property / Item No.", render: a => `<b>${esc(a.propertyNo || "—")}</b>` },
      { label: "Description", render: a => `${esc(a.description)}<div class="xs muted">${a.itemType === "ppe" ? "PPE" : "Semi-expendable"} · ${esc(a.source?.kind?.toUpperCase() || "")} ${esc(a.source?.number || "")}</div>` },
      { label: "Qty", render: a => `${qty(a.qty)} ${esc(a.unit)}`, cls: "right" },
      { label: "Cost", render: a => money(a.cost), cls: "right", headCls: "right" },
      { label: "Acquired", render: a => fmtDate(a.dateAcquired) },
      { label: "", render: a => `<button class="btn sm" data-card="${esc(a.id)}">Print card</button>` }
    ],
    empty: "No property is recorded under your name."
  });
  $("#t", main).addEventListener("click", e => { const b = e.target.closest("[data-card]"); if (b) printForm(propertyCardHtml(rows.find(a => a.id === b.dataset.card), [])); });
}
mine.deps = ["r:assets"];

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
  const ppe = a.itemType === "ppe", runs = S.d.depr.filter(r => r.fund === a.fund);
  const dh = ppe ? deprHistory(a, runs) : [];
  const ad = ppe ? accumAsOf(a, nowPeriod(), runs) : 0;
  const onHand = ["active", "returned"].includes(a.status);
  main.innerHTML = `<div class="page-head"><div><h1>${esc(a.description)}</h1><p>${ppe ? "Property No." : "Item No."} ${esc(a.propertyNo || "—")} · ${esc(fundName(a.fund))} · ${ppe ? "PPE" : "Semi-expendable"}</p></div><div class="btn-row">${statusBadge(a.status)}</div></div>
    <div class="split"><div>
      <div class="card"><h3>History</h3><ul class="timeline">${(a.history || []).slice().reverse().map(h => `<li class="done"><div>${esc(h.action)}${h.note ? ` — <i>${esc(h.note)}</i>` : ""}</div><div class="when">${fmtDateTime(h.at)} · ${esc(h.by)}</div></li>`).join("")}</ul></div>
      ${ppe ? `<div class="card"><div class="card-head"><h3>Depreciation</h3><span class="small muted">${isDepreciable(a) ? `${money(monthlyRate(a))} a month` : "Not depreciated"}</span></div>
        ${dh.length ? `<div class="table-wrap"><table><thead><tr><th>Period</th><th>JEV No.</th><th class="right">Depreciation</th><th class="right">Accumulated</th><th class="right">Carrying amount</th></tr></thead>
        <tbody>${dh.map(r => `<tr><td>${esc(r.period)}</td><td>${esc(r.jevNo)}</td><td class="right">${num(r.amount)}</td><td class="right">${num(r.accum)}</td><td class="right">${num(r.carrying)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted small">No depreciation posted yet.</p>`}</div>` : ""}
    </div><div>
      <div class="card"><h3>Details</h3><dl class="kv">
        <dt>${ppe ? "Property No." : "Item No."}</dt><dd>${esc(a.propertyNo || "—")}</dd>
        <dt>Account</dt><dd>${esc(a.accountCode)} ${esc(accountName(a.accountCode))}</dd>
        ${a.specs ? `<dt>Specifications</dt><dd>${esc(a.specs)}</dd>` : ""}
        <dt>Quantity</dt><dd>${qty(a.qty)} ${esc(a.unit)}</dd>
        <dt>Cost</dt><dd>${money(a.cost)}</dd>
        <dt>Date acquired</dt><dd>${fmtDate(a.dateAcquired)}</dd>
        ${ppe ? `<dt>Useful life</dt><dd>${esc(a.usefulLifeYears || 0)} years</dd><dt>Residual value</dt><dd>${money(a.residualValue)}</dd><dt>Accumulated depr.</dt><dd>${money(ad)}</dd><dt>Carrying amount</dt><dd><b>${money(a.cost - ad)}</b></dd>` : `<dt>Est. useful life</dt><dd>${esc(a.estimatedLife || "—")}</dd>`}
        <dt>Accountable officer</dt><dd>${esc(a.holder?.name || "—")}${a.holder?.office ? `<div class="xs muted">${esc(a.holder.office)}</div>` : ""}</dd>
        <dt>Location</dt><dd>${esc(a.location || "—")}</dd><dt>Condition</dt><dd>${esc(a.condition || "—")}</dd>
        <dt>Source</dt><dd>${a.source?.kind === "import" ? "Imported from PMS" : `<a href="#/issuances/${esc(a.source?.docId)}">${esc(a.source?.kind?.toUpperCase())} ${esc(a.source?.number)}</a> · <a href="#/airs/${esc(a.source?.airId)}">AIR ${esc(a.source?.airNo)}</a>`}</dd>
        ${a.disposal ? `<dt>Disposal</dt><dd>${esc(a.disposal.reason)}${a.disposal.date ? ` · ${fmtDate(a.disposal.date)}` : ""}${a.disposal.ref ? ` · ${esc(a.disposal.ref)}` : ""}</dd>` : ""}
      </dl>
      <div class="btn-row" style="margin-top:1rem">
        <button class="btn sm" id="card">Print ${ppe ? "Property Card" : "SP Card"}</button>
        ${(can("issue") || can("post")) && a.status !== "cancelled" ? `<button class="btn sm" id="edit">Correct record</button>` : ""}
        ${can("issue") && onHand ? `<button class="btn sm" data-mv="transfer">Transfer</button>${a.status === "active" ? `<button class="btn sm" data-mv="return">Return to GSO</button>` : ""}<button class="btn sm danger" data-mv="dispose">Dispose</button>` : ""}
      </div></div>
    </div></div>`;
  $("#card", main).onclick = () => printForm(propertyCardHtml(a, dh));
  $$("[data-mv]", main).forEach(b => b.onclick = () => movementModal(b.dataset.mv, [a]));
  $("#edit", main) && ($("#edit", main).onclick = () => editModal(a));
}
detail.deps = ["r:assets", "r:depr"];

function editModal(a) {
  const ppe = a.itemType === "ppe", gso = can("issue");
  const m = openModal(`<h2>Correct record</h2><p class="muted small">Cost, account, fund and date acquired can't be changed here; they come from the PAR/ICS or the import.</p>
    <form class="grid g2" id="ef">
      <div><label>${ppe ? "Property No." : "Item No."}</label><input name="propertyNo" value="${esc(a.propertyNo || "")}"></div>
      ${gso ? `<div><label>Location</label><input name="location" value="${esc(a.location || "")}"></div>
      <div class="spanall"><label>Description</label><input name="description" value="${esc(a.description)}"></div>` : ""}
      <div><label>Condition</label><select name="condition">${opts(["Serviceable", "Needs repair", "Unserviceable"], a.condition)}</select></div>
      ${ppe ? `<div><label>Useful life (years)</label><input type="number" min="0" step="1" name="usefulLifeYears" value="${esc(a.usefulLifeYears || 0)}"></div>
        <div><label>Residual value (₱)</label><input type="number" min="0" step="0.01" name="residualValue" value="${esc(a.residualValue || 0)}"></div>` : gso ? `<div><label>Estimated useful life</label><input name="estimatedLife" value="${esc(a.estimatedLife || "")}"></div>` : ""}
      <div class="spanall"><label class="req">Reason for the correction</label><input name="note"></div>
      <div class="spanall modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`, { size: "narrow" });
  $("[data-x]", m).onclick = () => m.close();
  $("#ef", m).onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    if (!v.note.trim()) return toast("Enter the reason for the correction.", "err");
    const { note, ...patch } = v;
    busy(e.submitter, async () => { await updateAsset(a.id, patch, note); m.close(); }, "Record updated.").catch(() => {});
  };
}

/* ---------------- transfer / return / dispose ---------------- */
function movementModal(kind, assets) {
  const err = checkMovement(assets, kind);
  if (err) return toast(err, "err");
  const s = settings(), sx = assets[0].itemType === "sx", runs = S.d.depr.filter(r => r.fund === assets[0].fund);
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
      ${kind === "transfer" ? `<div><label>Transfer type</label><select name="transferType">${opts(TRANSFER_TYPES, "reassignment")}</select></div>
        <div><label class="req">To (accountable officer)</label><input name="toName" list="ulist" autocomplete="off"></div>
        <div><label>Position</label><input name="toPos"></div>
        <div><label>Office</label><input name="toOffice" list="olist"></div>
        <div><label>Others — specify</label><input name="typeOther"></div>
        <datalist id="ulist">${users.map(u => `<option value="${esc(u.displayName)}">${esc(u.office)}</option>`).join("")}</datalist>
        <datalist id="olist">${s.offices.map(o => `<option value="${esc(o)}">`).join("")}</datalist>` : ""}
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
    const h = { date: v.date, reason: v.reason || "", lines, transferType: v.transferType, typeOther: v.typeOther || "", mode: v.mode || "", ref: v.ref || "",
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
      <div class="btn-row"><button class="btn primary" id="print">Print</button>${can("issue") && x.needsPosting && x.status !== "cancelled" && !x.posting?.posted ? `<button class="btn danger" id="cancel">Cancel</button>` : ""}</div></div>
    ${x.status === "cancelled" ? `<div class="notice bad">Cancelled — ${esc(x.cancel?.reason)}</div>` : ""}
    <div class="card"><dl class="kv"><dt>From</dt><dd>${esc(x.from?.name || "—")} ${esc(x.from?.office ? "· " + x.from.office : "")}</dd>
      ${x.to ? `<dt>To</dt><dd>${esc(x.to.name)} ${esc(x.to.office ? "· " + x.to.office : "")}</dd>` : ""}
      ${x.transferType ? `<dt>Transfer type</dt><dd>${esc(x.transferType)}${x.typeOther ? ` — ${esc(x.typeOther)}` : ""}</dd>` : ""}
      ${x.mode ? `<dt>Mode</dt><dd>${esc(x.mode)}${x.ref ? ` · ${esc(x.ref)}` : ""}</dd>` : ""}
      ${x.reason ? `<dt>Reason</dt><dd>${esc(x.reason)}</dd>` : ""}
      ${x.needsPosting ? `<dt>Accounting</dt><dd>${x.posting?.posted ? `Posted · ${esc(x.posting.ref)} · ${fmtDate(x.posting.date)}` : "Not yet posted"}</dd>` : ""}</dl></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Property / Item No.</th><th>Description</th><th class="right">Qty</th><th class="right">Cost</th>${x.docType === "dsp" ? `<th class="right">Carrying</th>` : ""}<th>Condition</th></tr></thead>
      <tbody>${x.lines.map(l => `<tr class="click" onclick="location.hash='#/assets/${esc(l.assetId)}'"><td>${esc(l.propertyNo || "—")}</td><td>${esc(l.description)}</td><td class="right">${qty(l.qty)}</td><td class="right">${num(l.amount)}</td>${x.docType === "dsp" ? `<td class="right">${num(l.carrying)}</td>` : ""}<td>${esc(l.condition)}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#print", main).onclick = () => printForm(movementHtml(x), x.docType === "dsp" ? "landscape" : "portrait");
  $("#cancel", main) && ($("#cancel", main).onclick = async e => {
    const v = await confirmBox({ title: `Cancel ${DOC_NAMES[x.docType]} ${x.number}?`, body: "The items return to how they were before.", fields: [{ name: "reason", label: "Reason", type: "textarea", required: true }], confirmText: "Cancel it", danger: true });
    if (v) busy(e.target, () => cancelMovement(x.id, v.reason), "Cancelled.").catch(() => {});
  });
}
movement.deps = ["r:movements"];

