// History of Repair: request → GSO pre-repair inspection → job order → GSO post-repair inspection (+ WMR) →
// Accounting posts → GSO verifies, and the repair joins the item's history.
import { S, can, role, settings, assetById } from "../state.js";
import { officeSelect, $, $$, esc, busy, money, num, qty, fmtDate, fmtDateTime, manilaToday, opts, renderTable, confirmBox, downloadCSV } from "../ui.js";
import { fundName, FUNDS } from "../core/catalog.js";
import { REPAIR_STATUS, repairTotal, repairStage } from "../core/assets.js";
import { saveRepair, deleteRepair, reviewRepair, inspectRepair, setPosting } from "../data.js";
import { printForm, repairHistoryHtml, repairInspectionHtml, wmrHtml } from "../print.js";

const clean = () => window.dispatchEvent(new Event("app:clean"));
const badge = s => `<span class="badge ${{ requested: "b-warn", preinspected: "b-info", repaired: "b-warn", submitted: "b-warn", inspected: "b-gold", posted: "b-info", returned: "b-bad", verified: "b-ok" }[s] || ""}">${esc(REPAIR_STATUS[s] || s)}</span>`;
const mine = r => r.endUserUid === S.user.uid;
const canEdit = r => ["requested", "preinspected", "repaired", "submitted", "returned"].includes(r.status) && (mine(r) || can("issue"));
/** The last verified repair of the item, offered as the "nature and scope of last repair". */
const lastRepairOf = (assetId, exceptId) => S.d.repairs.filter(x => x.assetId === assetId && x.id !== exceptId && ["verified", "posted"].includes(x.status))
  .sort((a, b) => String(b.jobOrderDate).localeCompare(String(a.jobOrderDate)))[0];
/** Items the user may record a repair for: their own (End-User) or any on hand (GSO). */
const repairable = () => (role() === "enduser" ? S.d.assets : S.d.assets.filter(a => a.fund === S.fund)).filter(a => ["active", "returned"].includes(a.status));
export const repairsOf = assetId => S.d.repairs.filter(r => r.assetId === assetId);
export const printHistory = a => printForm(repairHistoryHtml(a, repairsOf(a.id)));

export function list(main) {
  const enduser = role() === "enduser";
  const rows = enduser ? S.d.repairs : S.d.repairs.filter(r => r.fund === S.fund);
  main.innerHTML = `<div class="page-head"><div><h1>History of Repair</h1><p>${enduser ? "Request the repair of property under your name. The GSO inspects it before and after the repair, Accounting posts it, and once verified it becomes part of the item's history." : `Repairs in the ${esc(fundName(S.fund))}: pre-repair inspection, job order, post-repair inspection (with the WMR), Accounting posting and verification.`}</p></div>
    <div class="btn-row"><a class="btn primary" href="#/repairs/new">Request a repair</a><button class="btn" id="csv">CSV</button></div></div><div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "repairs-" + role(), rows, pageSize: 50, defaultSort: 0, defaultDir: -1,
    searchText: r => `${r.jobOrderNo} ${r.propertyNo} ${r.description} ${r.makeModel} ${r.plateNo} ${r.supplier} ${r.endUser}`,
    searchPlaceholder: "Job order, property no., item, plate no., supplier",
    filters: [{ key: "s", label: "Status", options: Object.entries(REPAIR_STATUS), value: "", test: (r, v) => r.status === v },
      ...(enduser ? [{ key: "f", label: "Fund", options: FUNDS.map(f => [f.code, f.name]), test: (r, v) => r.fund === v }] : [])],
    columns: [
      { label: "JO date", render: r => fmtDate(r.jobOrderDate), sort: r => r.jobOrderDate },
      { label: "Job Order No.", render: r => `<b>${esc(r.jobOrderNo)}</b>`, sort: r => r.jobOrderNo },
      { label: "Item", render: r => `${esc(r.description)}<div class="xs muted">${esc(r.propertyNo || "—")}${r.plateNo ? ` · ${esc(r.plateNo)}` : ""}</div>`, sort: r => r.description },
      { label: "End user", render: r => `${esc(r.endUser)}<div class="xs muted">${esc(r.office)}</div>` },
      { label: "Supplier", render: r => esc(r.supplier || "—") },
      { label: "Cost", render: r => money(r.totalCost), sort: r => r.totalCost, cls: "right", headCls: "right" },
      { label: "Status", render: r => badge(r.status), sort: r => r.status }
    ],
    empty: enduser ? "You have not recorded any repairs yet." : "No repairs in this view.",
    footer: l => `<tr><td colspan="5" class="right">Total</td><td class="right">${money(l.reduce((t, r) => t + r.totalCost, 0))}</td><td></td></tr>`,
    onRow: r => { location.hash = `#/repairs/${r.id}`; }
  });
  $("#csv", main).onclick = () => downloadCSV(`Repairs-${S.fund}`, ["JO Date", "Job Order No.", "Property No.", "Item", "Plate No.", "End User", "Office", "Supplier", "Invoice/PO No.", "Nature", "Total Cost", "Status"],
    t.rows().map(r => [r.jobOrderDate, r.jobOrderNo, r.propertyNo, r.description, r.plateNo, r.endUser, r.office, r.supplier, r.invoiceNo, r.nature, r.totalCost, REPAIR_STATUS[r.status]]));
}
list.deps = ["r:repairs", "fund"];

/** #/repairs/new[/assetId] or #/repairs/<id>/edit — the request, or (once approved for repair) the job order. */
export function form(main, [id, assetId]) {
  const r = id ? S.d.repairs.find(x => x.id === id) : null;
  if (id && (!r || !canEdit(r))) { location.hash = id ? `#/repairs/${id}` : "#/repairs"; return; }
  const stage = repairStage(r), jo = stage === "repair";
  const items = repairable();
  let asset = r ? assetById(r.assetId) || { id: r.assetId, fund: r.fund, propertyNo: r.propertyNo, description: r.description } : assetId ? assetById(assetId) : null;
  const parts = r?.parts?.length ? r.parts.map(l => ({ ...l })) : [{}];
  const v = k => esc(r?.[k] ?? "");
  const last = asset ? lastRepairOf(asset.id, r?.id) : null;
  const lastText = x => x ? `${x.nature || x.parts?.map(l => l.description).join(", ") || "Repair"} — JO ${x.jobOrderNo}, ${fmtDate(x.jobOrderDate)} (${money(x.totalCost)})` : "";
  main.innerHTML = `<div class="page-head"><div><h1>${jo ? `Job order${r?.jobOrderNo ? ` — JO ${esc(r.jobOrderNo)}` : ""}` : r ? "Edit the repair request" : "Request a repair"}</h1>
      <p>${jo ? "The GSO approved this repair. Record the job order: repair shop, invoice, spare parts and labor. The GSO then does the post-repair inspection." : `Describe the complaints. The GSO inspects the item before it is repaired. ${role() === "enduser" ? "Only property under your name can be chosen." : ""}`}</p></div></div>
    ${r?.status === "returned" && r.gsoRemarks ? `<div class="notice bad"><b>Returned by the GSO:</b> ${esc(r.gsoRemarks)}</div>` : ""}
    ${jo && r?.preInspection ? `<div class="notice info"><b>Pre-repair inspection</b> (${fmtDate(r.preInspection.date)}, ${esc(r.preInspection.inspector)}): ${esc(r.preInspection.findings)}</div>` : ""}
    <form id="rf" class="card" novalidate>
      <div class="grid g2">
        <div class="spanall"><label class="req">Item to be repaired</label>
          ${r ? `<input value="${esc(`${asset.propertyNo || "—"} — ${asset.description}`)}" disabled>` : `<select name="assetId">${[`<option value="">Choose the item</option>`, ...items.map(a => `<option value="${esc(a.id)}" ${a.id === asset?.id ? "selected" : ""}>${esc(a.propertyNo || "—")} — ${esc(a.description)}</option>`)].join("")}</select>`}
          ${!r && !items.length ? `<div class="xs muted">No property is recorded under your name, so there is nothing to choose yet.</div>` : ""}</div>
        <div><label>Make &amp; model</label><input name="makeModel" value="${v("makeModel")}"></div>
        <div><label>Unit / serial no.</label><input name="unitSerialNo" value="${v("unitSerialNo")}"></div>
        <div><label>Engine serial no.</label><input name="engineSerialNo" value="${v("engineSerialNo")}"></div>
        <div><label>Plate no.</label><input name="plateNo" value="${v("plateNo")}"></div>
        <div><label>End user</label><input name="endUser" value="${v("endUser")}"></div>
        <div><label>Designation</label><input name="designation" value="${v("designation")}"></div>
        <div class="spanall"><label>Office</label>${officeSelect("office", r?.office || "", settings().offices)}</div>
        <div class="spanall"><label class="${jo ? "" : "req"}">Complaints / defects</label><textarea name="complaints" rows="2">${v("complaints")}</textarea></div>
        <div class="spanall"><label>Parts / components to be repaired or replaced</label><textarea name="partsToRepair" rows="2">${v("partsToRepair")}</textarea></div>
        <div class="spanall"><label>Nature and scope of last repair, if any</label><input name="lastRepair" value="${esc(r?.lastRepair ?? lastText(last))}"></div>
      </div>
      <div ${jo ? "" : "hidden"}>
      <h3 style="margin-top:1.2rem">Job order</h3>
      <div class="grid g3">
        <div><label class="req">Job Order No.</label><input name="jobOrderNo" value="${v("jobOrderNo")}"></div>
        <div><label class="req">Job Order date</label><input type="date" name="jobOrderDate" value="${esc(r?.jobOrderDate || manilaToday())}"></div>
        <div><label>Supplier / repair shop</label><input name="supplier" value="${v("supplier")}"></div>
        <div><label>Invoice / PO No.</label><input name="invoiceNo" value="${v("invoiceNo")}"></div>
        <div><label>Invoice / PO date</label><input type="date" name="invoiceDate" value="${v("invoiceDate")}"></div>
        <div><label>Nature of repair</label><input name="nature" value="${v("nature")}" placeholder="e.g. Change oil, brake repair"></div>
      </div>
      <h3 style="margin-top:1.2rem">Spare parts / materials and labor</h3>
      <div class="table-wrap"><table class="lines"><thead><tr><th class="right">Qty</th><th>Unit</th><th>Description</th><th class="right">Cost</th><th>Remarks</th><th></th></tr></thead><tbody id="pl"></tbody>
        <tfoot><tr><td colspan="3" class="right">Total</td><td class="tot" id="pt"></td><td colspan="2"></td></tr></tfoot></table></div>
      <button type="button" class="btn sm" id="addp" style="margin-top:.6rem">+ Add line</button>
      </div>
      <h3 style="margin-top:1.2rem">Signatories</h3>
      <div class="grid g2">
        <div><label>Prepared by</label><input name="preparedBy" value="${esc(r?.preparedBy?.name ?? S.account?.displayName ?? "")}"></div>
        <div><label>Position / office</label><input name="preparedByPos" value="${esc(r?.preparedBy?.position ?? S.account?.position ?? "")}"></div>
        <div><label>Noted by</label><input name="notedBy" value="${esc(r?.notedBy?.name || "")}"></div>
        <div><label>Position / office</label><input name="notedByPos" value="${esc(r?.notedBy?.position || "")}"></div>
      </div>
      <div class="form-msg err" id="msg"></div>
      <div class="modal-actions"><a class="btn" href="${r ? `#/repairs/${r.id}` : "#/repairs"}">Cancel</a><button class="btn primary" type="submit">${jo ? "Send for post-repair inspection" : "Send for pre-repair inspection"}</button></div>
    </form>`;
  const f = $("#rf", main), pl = $("#pl", main);
  const draw = () => {
    pl.innerHTML = parts.map((l, i) => `<tr data-i="${i}"><td><input type="number" min="0" step="any" class="w-xs" data-k="qty" value="${esc(l.qty ?? "")}"></td><td><input class="w-xs" data-k="unit" value="${esc(l.unit || "")}"></td>
      <td><input class="w-lg" data-k="description" value="${esc(l.description || "")}" placeholder="Spare part, material or labor"></td><td><input type="number" min="0" step="0.01" class="w-sm" data-k="cost" value="${esc(l.cost ?? "")}"></td>
      <td><input class="w-md" data-k="remarks" value="${esc(l.remarks || "")}"></td><td><button type="button" class="btn sm ghost" data-rm>✕</button></td></tr>`).join("");
    $("#pt", main).textContent = money(repairTotal({ parts }));
  };
  draw();
  pl.addEventListener("input", e => { const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return; parts[+tr.dataset.i][k] = e.target.value; $("#pt", main).textContent = money(repairTotal({ parts })); });
  pl.addEventListener("click", e => { if (!e.target.closest("[data-rm]")) return; parts.splice(+e.target.closest("tr").dataset.i, 1); if (!parts.length) parts.push({}); draw(); });
  $("#addp", main).onclick = () => { parts.push({}); draw(); };
  const fill = a => { if (!a) return; f.makeModel.value ||= a.description || ""; f.endUser.value ||= a.holder?.name || ""; f.office.value ||= a.holder?.office || a.location || ""; if (role() === "enduser") f.designation.value ||= S.account?.position || ""; f.lastRepair.value ||= lastText(lastRepairOf(a.id)); };
  if (!r) { fill(asset); f.assetId && (f.assetId.onchange = () => { asset = assetById(f.assetId.value); ["makeModel", "endUser", "office", "lastRepair"].forEach(k => { f[k].value = ""; }); fill(asset); }); }
  f.onsubmit = e => {
    e.preventDefault();
    const data = { ...Object.fromEntries(new FormData(f).entries()), parts: jo ? parts : [] };
    $("#msg", main).textContent = "";
    busy(e.submitter, async () => {
      try { const rid = await saveRepair(r?.id, data, asset); clean(); location.hash = `#/repairs/${rid}`; }
      catch (err) { $("#msg", main).textContent = err.message; throw err; }
    }, jo ? "Sent to the GSO for the post-repair inspection." : "Repair requested — the GSO will do the pre-repair inspection.").catch(() => {});
  };
}
form.deps = [];

export function detail(main, [id]) {
  const r = S.d.repairs.find(x => x.id === id);
  if (!r) { main.innerHTML = `<div class="notice warn">Repair record not found.</div>`; return; }
  const a = assetById(r.assetId), st = r.status, legacy = st === "submitted" || (!r.preInspection && r.jobOrderNo);
  const done = k => ({ request: true, pre: !!r.preInspection?.approved || legacy, jo: !!r.jobOrderNo && st !== "requested" && st !== "preinspected", post: !!r.postInspection?.approved, posted: !!r.posting?.posted, verified: st === "verified" })[k];
  const steps = [["request", "Request", r.encodedBy?.name], ["pre", "Pre-repair inspection", legacy && !r.preInspection ? "not done (recorded earlier)" : r.preInspection?.inspector], ["jo", "Job order", r.jobOrderNo ? `JO ${r.jobOrderNo}` : ""],
    ["post", "Post-repair inspection", r.postInspection?.inspector], ["posted", "Accounting posting", r.posting?.ref], ["verified", "Verified", r.verifiedBy?.name]];
  const now = { requested: "pre", preinspected: "jo", repaired: "post", submitted: "post", inspected: "posted", posted: "verified", returned: repairStage(r) === "request" ? "request" : "jo" }[st];
  const insp = (t, x) => x ? `<div class="card"><h3>${t}</h3><dl class="kv"><dt>Findings</dt><dd style="white-space:pre-wrap">${esc(x.findings)}</dd><dt>Inspector</dt><dd>${esc(x.inspector || "—")} · ${fmtDate(x.date)}</dd>
    <dt>Result</dt><dd>${x.approved ? `<span class="badge b-ok">${t.startsWith("Pre") ? "Approved for repair" : "Accepted"}</span>` : `<span class="badge b-bad">Returned</span>`}</dd></dl></div>` : "";
  const inspForm = (which) => `<div class="card"><h3>${which === "pre" ? "Pre-repair inspection" : "Post-repair inspection"}</h3><form class="grid g2" id="inf">
      <div class="spanall"><label class="req">${which === "pre" ? "Findings / observations" : "Findings / comments"}</label><textarea name="findings" rows="3"></textarea></div>
      <div><label>Property Inspector</label><input name="inspector" value="${esc(settings().signatories.inspector || S.account?.displayName || "")}"></div>
      <div><label class="req">Date</label><input type="date" name="date" value="${manilaToday()}"></div>
      ${which === "post" ? `<div class="spanall"><label class="check"><input type="checkbox" name="hasWmr" id="haswmr"> Parts were replaced — prepare a Waste Materials Report (WMR)</label></div>
      <div class="spanall" id="wmrbox" hidden><div class="grid g3"><div><label>Place of storage</label><input name="wPlace" placeholder="e.g. GSO warehouse"></div><div><label>WMR date</label><input type="date" name="wDate" value="${manilaToday()}"></div>
        <div><label>Disposed of by</label><select name="wDisposal">${opts([["", "Not yet disposed"], ["destroyed", "Destroyed"], ["private", "Sold at private sale"], ["auction", "Sold at public auction"], ["transferred", "Transferred without cost"]], "")}</select></div>
        <div class="spanall"><label>Transferred to (if transferred)</label><input name="wTo"></div></div>
        <div class="table-wrap" style="margin-top:.6rem"><table class="lines"><thead><tr><th class="right">Qty</th><th>Unit</th><th>Description</th><th>OR No.</th><th>OR date</th><th class="right">Amount</th></tr></thead><tbody id="wl">
          ${Array.from({ length: 4 }, () => `<tr><td><input type="number" min="0" step="any" class="w-xs" data-w="qty"></td><td><input class="w-xs" data-w="unit"></td><td><input class="w-lg" data-w="description" placeholder="Part removed / replaced"></td>
            <td><input class="w-sm" data-w="orNo"></td><td><input type="date" data-w="orDate"></td><td><input type="number" min="0" step="0.01" class="w-sm" data-w="amount"></td></tr>`).join("")}</tbody></table></div></div>` : ""}
      <div class="spanall btn-row end"><button type="button" class="btn danger" id="inret">Return to End-User</button><button class="btn ok" type="submit">${which === "pre" ? "Approve for repair" : "Accept — for Accounting posting"}</button></div></form></div>`;
  const action = can("issue") && st === "requested" ? inspForm("pre")
    : can("issue") && ["repaired", "submitted"].includes(st) ? inspForm("post")
    : can("post") && st === "inspected" ? `<div class="card"><h3>Accounting posting</h3><form class="grid g2" id="psf"><div><label class="req">Posting date</label><input type="date" name="date" value="${manilaToday()}"></div>
        <div><label class="req">JEV / reference no.</label><input name="ref"></div><div class="spanall btn-row end"><button class="btn primary" type="submit">Post repair</button></div></form></div>`
    : can("issue") && st === "posted" ? `<div class="card"><h3>Verification</h3><form class="grid g2" id="vf">
        <div><label>Verified by</label><input name="vName" value="${esc(S.account?.displayName || "")}"></div><div><label>Position / office</label><input name="vPos" value="${esc(S.account?.position || "")}"></div>
        <div class="spanall"><label>Remarks</label><input name="remarks"></div><div class="spanall btn-row end"><button class="btn ok" type="submit">Verify</button></div></form></div>`
    : st === "preinspected" && canEdit(r) ? `<div class="notice info">Approved for repair. Once the item is repaired, <a href="#/repairs/${esc(r.id)}/edit"><b>record the job order</b></a> for the post-repair inspection.</div>` : "";
  main.innerHTML = `<div class="page-head"><div><h1>Repair${r.jobOrderNo ? ` — JO ${esc(r.jobOrderNo)}` : ""}</h1><p>${esc(r.description)} · ${esc(r.propertyNo || "—")} · ${esc(fundName(r.fund))}</p></div><div class="btn-row">${badge(st)}</div></div>
    <div class="steps">${steps.map(([k, t, sub]) => `<div class="${st === "returned" && k === now ? "bad" : k === now ? "now" : done(k) ? "done" : ""}"><b>${esc(t)}</b>${esc(sub || "")}</div>`).join("")}</div>
    ${st === "returned" && r.gsoRemarks ? `<div class="notice bad"><b>Returned by the GSO:</b> ${esc(r.gsoRemarks)}</div>` : ""}
    <div class="split"><div>
      ${action}
      <div class="card"><h3>Request</h3><dl class="kv"><dt>Complaints / defects</dt><dd style="white-space:pre-wrap">${esc(r.complaints || "—")}</dd>
        <dt>Parts to repair / replace</dt><dd style="white-space:pre-wrap">${esc(r.partsToRepair || "—")}</dd><dt>Last repair</dt><dd>${esc(r.lastRepair || "—")}</dd></dl></div>
      ${insp("Pre-repair inspection", r.preInspection)}
      ${r.jobOrderNo ? `<div class="card"><div class="card-head"><h3>Spare parts / materials and labor</h3><span class="small muted">Total ${money(r.totalCost)}</span></div>
        <div class="table-wrap"><table><thead><tr><th class="right">Qty</th><th>Unit</th><th>Description</th><th class="right">Cost</th><th>Remarks</th></tr></thead>
        <tbody>${(r.parts || []).map(l => `<tr><td class="right">${qty(l.qty)}</td><td>${esc(l.unit)}</td><td>${esc(l.description)}</td><td class="right">${num(l.cost)}</td><td>${esc(l.remarks)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      ${insp("Post-repair inspection", r.postInspection)}
      ${r.wmr ? `<div class="card"><div class="card-head"><h3>Waste Materials Report</h3><button class="btn sm" id="pwmr">Print WMR</button></div>
        <ul class="small">${r.wmr.items.map(l => `<li>${qty(l.qty)} ${esc(l.unit)} — ${esc(l.description)}${l.amount ? ` · sold ${money(l.amount)} (OR ${esc(l.orNo)})` : ""}</li>`).join("")}</ul></div>` : ""}
    </div><div>
      <div class="card"><h3>Details</h3><dl class="kv">
        <dt>Item</dt><dd>${a ? `<a href="#/${can("viewAll") ? `assets/${esc(a.id)}` : "myproperty"}">${esc(r.description)}</a>` : esc(r.description)}</dd>
        <dt>Make &amp; model</dt><dd>${esc(r.makeModel || "—")}</dd>
        ${r.unitSerialNo ? `<dt>Unit / serial no.</dt><dd>${esc(r.unitSerialNo)}</dd>` : ""}${r.engineSerialNo ? `<dt>Engine serial no.</dt><dd>${esc(r.engineSerialNo)}</dd>` : ""}${r.plateNo ? `<dt>Plate no.</dt><dd>${esc(r.plateNo)}</dd>` : ""}
        <dt>End user</dt><dd>${esc(r.endUser || "—")}${r.designation ? ` · ${esc(r.designation)}` : ""}<div class="xs muted">${esc(r.office)}</div></dd>
        ${r.jobOrderNo ? `<dt>Job order</dt><dd>${esc(r.jobOrderNo)} · ${fmtDate(r.jobOrderDate)}</dd><dt>Supplier</dt><dd>${esc(r.supplier || "—")}</dd>
        <dt>Invoice / PO</dt><dd>${esc(r.invoiceNo || "—")}${r.invoiceDate ? ` · ${fmtDate(r.invoiceDate)}` : ""}</dd>${r.nature ? `<dt>Nature</dt><dd>${esc(r.nature)}</dd>` : ""}` : ""}
        ${r.posting?.posted ? `<dt>Posted</dt><dd>${esc(r.posting.ref)} · ${fmtDate(r.posting.date)}</dd>` : ""}
        <dt>Requested</dt><dd>${fmtDateTime(r.createdAt)} · ${esc(r.encodedBy?.name)}</dd>
        ${st === "verified" ? `<dt>Verified</dt><dd>${esc(r.verifiedBy?.name)} · ${fmtDateTime(r.reviewedAt)}</dd>` : ""}
      </dl>
      <div class="btn-row" style="margin-top:1rem">${r.preInspection || r.postInspection ? `<button class="btn sm" id="pins">Print Inspection Report</button>` : ""}<button class="btn sm" id="pr">Print History of Repair</button>
        ${can("post") && st === "posted" ? `<button class="btn sm" id="unpost">Unpost</button>` : ""}
        ${canEdit(r) ? `<a class="btn sm" href="#/repairs/${esc(r.id)}/edit">${st === "preinspected" ? "Record the job order" : st === "returned" ? "Correct and resend" : "Edit"}</a>` : ""}
        ${canEdit(r) && ["requested", "returned"].includes(st) ? `<button class="btn sm danger" id="del">Delete</button>` : ""}</div></div>
    </div></div>`;
  $("#pr", main).onclick = () => printForm(repairHistoryHtml(a, repairsOf(r.assetId)));
  $("#pins", main) && ($("#pins", main).onclick = () => printForm(repairInspectionHtml(r, a)));
  $("#pwmr", main) && ($("#pwmr", main).onclick = () => printForm(wmrHtml(r)));
  $("#del", main) && ($("#del", main).onclick = async e => {
    if (!(await confirmBox({ title: "Delete this repair request?", confirmText: "Delete", danger: true }))) return;
    busy(e.target, async () => { await deleteRepair(r.id); location.hash = "#/repairs"; }, "Deleted.").catch(() => {});
  });
  const inf = $("#inf", main);
  if (inf) {
    const which = st === "requested" ? "pre" : "post";
    $("#haswmr", main) && ($("#haswmr", main).onchange = e => { $("#wmrbox", main).hidden = !e.target.checked; });
    const read = () => {
      const v = Object.fromEntries(new FormData(inf).entries());
      const wmr = v.hasWmr ? { placeOfStorage: v.wPlace, date: v.wDate, disposal: v.wDisposal, transferredTo: v.wTo,
        items: $$("#wl tr", main).map(tr => Object.fromEntries($$("[data-w]", tr).map(i => [i.dataset.w, i.value]))) } : null;
      return { findings: v.findings, inspector: v.inspector, date: v.date, wmr };
    };
    inf.onsubmit = e => { e.preventDefault(); busy(e.submitter, async () => { await inspectRepair(r.id, which, true, read()); clean(); }, which === "pre" ? "Approved for repair." : "Accepted — waiting for Accounting to post it.").catch(() => {}); };
    $("#inret", main).onclick = e => busy(e.target, async () => { await inspectRepair(r.id, which, false, read()); clean(); }, "Returned to the End-User.").catch(() => {});
  }
  const psf = $("#psf", main);
  if (psf) psf.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(psf).entries()); busy(e.submitter, async () => { await setPosting("repair", r.id, v); clean(); }, "Repair posted.").catch(() => {}); };
  $("#unpost", main) && ($("#unpost", main).onclick = async e => {
    if (await confirmBox({ title: "Unpost this repair?", body: "Use this only to correct a posting made in error.", confirmText: "Unpost", danger: true })) busy(e.target, () => setPosting("repair", r.id, null), "Posting removed.").catch(() => {});
  });
  const vf = $("#vf", main);
  if (vf) vf.onsubmit = e => { e.preventDefault(); busy(e.submitter, async () => { await reviewRepair(r.id, true, vf.remarks.value.trim(), { name: vf.vName.value.trim(), position: vf.vPos.value.trim() }); clean(); }, "Repair verified and added to the item's history.").catch(() => {}); };
}
detail.deps = ["r:repairs", "r:assets"];

