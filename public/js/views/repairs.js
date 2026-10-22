// History of Repair: End-Users record each job order on property under their name; the GSO verifies it.
import { S, can, role, settings, fundAssets, assetById } from "../state.js";
import { officeSelect, $, esc, busy, toast, money, num, qty, fmtDate, fmtDateTime, manilaToday, renderTable, confirmBox, downloadCSV } from "../ui.js";
import { fundName, FUNDS } from "../core/catalog.js";
import { REPAIR_STATUS, repairTotal } from "../core/assets.js";
import { saveRepair, deleteRepair, reviewRepair } from "../data.js";
import { printForm, repairHistoryHtml } from "../print.js";

const clean = () => window.dispatchEvent(new Event("app:clean"));
const badge = s => `<span class="badge ${{ submitted: "b-warn", returned: "b-bad", verified: "b-ok" }[s] || ""}">${esc(REPAIR_STATUS[s] || s)}</span>`;
const mine = r => r.endUserUid === S.user.uid;
const canEdit = r => r.status !== "verified" && (mine(r) || can("issue"));
/** Items the user may record a repair for: their own (End-User) or any on hand (GSO). */
const repairable = () => (role() === "enduser" ? S.d.assets : fundAssets()).filter(a => ["active", "returned"].includes(a.status));
export const repairsOf = assetId => S.d.repairs.filter(r => r.assetId === assetId);
export const printHistory = a => printForm(repairHistoryHtml(a, repairsOf(a.id)));

export function list(main) {
  const enduser = role() === "enduser";
  const rows = enduser ? S.d.repairs : S.d.repairs.filter(r => r.fund === S.fund);
  main.innerHTML = `<div class="page-head"><div><h1>History of Repair</h1><p>${enduser ? "Record every repair of property under your name — job order, supplier, spare parts and labor. The GSO verifies it and it becomes part of the item's history." : `Repairs recorded in the ${esc(fundName(S.fund))}. Verify each one against its job order, or return it with remarks.`}</p></div>
    <div class="btn-row"><a class="btn primary" href="#/repairs/new">Record a repair</a><button class="btn" id="csv">CSV</button></div></div><div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "repairs-" + role(), rows, pageSize: 50, defaultSort: 0, defaultDir: -1,
    searchText: r => `${r.jobOrderNo} ${r.propertyNo} ${r.description} ${r.makeModel} ${r.plateNo} ${r.supplier} ${r.endUser}`,
    searchPlaceholder: "Job order, property no., item, plate no., supplier",
    filters: [{ key: "s", label: "Status", options: Object.entries(REPAIR_STATUS), value: enduser ? "" : "submitted", test: (r, v) => r.status === v },
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

/** #/repairs/new[/assetId] or #/repairs/<id>/edit */
export function form(main, [id, assetId]) {
  const r = id ? S.d.repairs.find(x => x.id === id) : null;
  if (id && (!r || !canEdit(r))) { location.hash = id ? `#/repairs/${id}` : "#/repairs"; return; }
  const items = repairable();
  let asset = r ? assetById(r.assetId) || { id: r.assetId, fund: r.fund, propertyNo: r.propertyNo, description: r.description } : assetId ? assetById(assetId) : null;
  const parts = r ? r.parts.map(l => ({ ...l })) : [{}];
  const v = k => esc(r?.[k] ?? "");
  main.innerHTML = `<div class="page-head"><div><h1>${r ? `Edit repair — JO ${esc(r.jobOrderNo)}` : "Record a repair"}</h1><p>One record per job order. ${role() === "enduser" ? "Only property under your name can be chosen." : ""}</p></div></div>
    ${r?.status === "returned" && r.gsoRemarks ? `<div class="notice bad"><b>Returned by the GSO:</b> ${esc(r.gsoRemarks)}</div>` : ""}
    <form id="rf" class="card" novalidate>
      <div class="grid g2">
        <div class="spanall"><label class="req">Item repaired</label>
          ${r ? `<input value="${esc(`${asset.propertyNo || "—"} — ${asset.description}`)}" disabled>` : `<select name="assetId">${[`<option value="">Choose the item</option>`, ...items.map(a => `<option value="${esc(a.id)}" ${a.id === asset?.id ? "selected" : ""}>${esc(a.propertyNo || "—")} — ${esc(a.description)}${a.holder?.name ? ` (${esc(a.holder.name)})` : ""}</option>`)].join("")}</select>`}
          ${!r && !items.length ? `<div class="xs muted">No property is recorded under your name, so there is nothing to choose yet.</div>` : ""}</div>
        <div><label>Make &amp; model</label><input name="makeModel" value="${v("makeModel")}"></div>
        <div><label>Unit / serial no.</label><input name="unitSerialNo" value="${v("unitSerialNo")}"></div>
        <div><label>Engine serial no.</label><input name="engineSerialNo" value="${v("engineSerialNo")}"></div>
        <div><label>Plate no.</label><input name="plateNo" value="${v("plateNo")}"></div>
        <div><label>End user</label><input name="endUser" value="${v("endUser")}"></div>
        <div><label>Designation</label><input name="designation" value="${v("designation")}"></div>
        <div class="spanall"><label>Office</label>${officeSelect("office", r?.office || "", settings().offices)}</div>
      </div>
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
      <h3 style="margin-top:1.2rem">Signatories</h3>
      <div class="grid g2">
        <div><label>Prepared by</label><input name="preparedBy" value="${esc(r?.preparedBy?.name ?? S.account?.displayName ?? "")}"></div>
        <div><label>Position / office</label><input name="preparedByPos" value="${esc(r?.preparedBy?.position ?? S.account?.position ?? "")}"></div>
        <div><label>Noted by</label><input name="notedBy" value="${esc(r?.notedBy?.name || "")}"></div>
        <div><label>Position / office</label><input name="notedByPos" value="${esc(r?.notedBy?.position || "")}"></div>
      </div>
      <p class="xs muted">"Verified by" is filled in by the GSO when the repair is verified.</p>
      <div class="form-msg err" id="msg"></div>
      <div class="modal-actions"><a class="btn" href="${r ? `#/repairs/${r.id}` : "#/repairs"}">Cancel</a><button class="btn primary" type="submit">${r ? "Save and send for verification" : "Send for verification"}</button></div>
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
  const fill = a => { if (!a) return; f.makeModel.value ||= a.description || ""; f.endUser.value ||= a.holder?.name || ""; f.office.value ||= a.holder?.office || a.location || ""; if (role() === "enduser") f.designation.value ||= S.account?.position || ""; };
  if (!r) { fill(asset); f.assetId && (f.assetId.onchange = () => { asset = assetById(f.assetId.value); ["makeModel", "endUser", "office"].forEach(k => { f[k].value = ""; }); fill(asset); }); }
  f.onsubmit = e => {
    e.preventDefault();
    const data = { ...Object.fromEntries(new FormData(f).entries()), parts };
    $("#msg", main).textContent = "";
    busy(e.submitter, async () => {
      try { const rid = await saveRepair(r?.id, data, asset); clean(); location.hash = `#/repairs/${rid}`; }
      catch (err) { $("#msg", main).textContent = err.message; throw err; }
    }, "Repair sent to the GSO for verification.").catch(() => {});
  };
}
form.deps = [];

export function detail(main, [id]) {
  const r = S.d.repairs.find(x => x.id === id);
  if (!r) { main.innerHTML = `<div class="notice warn">Repair record not found.</div>`; return; }
  const a = assetById(r.assetId);
  main.innerHTML = `<div class="page-head"><div><h1>Repair — JO ${esc(r.jobOrderNo)}</h1><p>${esc(r.description)} · ${esc(r.propertyNo || "—")} · ${esc(fundName(r.fund))}</p></div><div class="btn-row">${badge(r.status)}</div></div>
    ${r.gsoRemarks ? `<div class="notice ${r.status === "returned" ? "bad" : "info"}"><b>GSO:</b> ${esc(r.gsoRemarks)}</div>` : ""}
    <div class="split"><div>
      <div class="card"><div class="card-head"><h3>Spare parts / materials and labor</h3><span class="small muted">Total ${money(r.totalCost)}</span></div>
        <div class="table-wrap"><table><thead><tr><th class="right">Qty</th><th>Unit</th><th>Description</th><th class="right">Cost</th><th>Remarks</th></tr></thead>
        <tbody>${r.parts.map(l => `<tr><td class="right">${qty(l.qty)}</td><td>${esc(l.unit)}</td><td>${esc(l.description)}</td><td class="right">${num(l.cost)}</td><td>${esc(l.remarks)}</td></tr>`).join("")}</tbody></table></div></div>
      ${can("issue") && r.status === "submitted" ? `<div class="card"><h3>Verification</h3><form class="grid g2" id="vf">
        <div><label>Verified by</label><input name="vName" value="${esc(S.account?.displayName || "")}"></div><div><label>Position / office</label><input name="vPos" value="${esc(S.account?.position || "")}"></div>
        <div class="spanall"><label>Remarks <span class="muted">(required when returning)</span></label><input name="remarks"></div>
        <div class="spanall btn-row end"><button type="button" class="btn danger" id="ret">Return to End-User</button><button class="btn ok" type="submit">Verify</button></div></form></div>` : ""}
    </div><div>
      <div class="card"><h3>Details</h3><dl class="kv">
        <dt>Item</dt><dd>${a ? `<a href="#/${can("viewAll") ? `assets/${esc(a.id)}` : "myproperty"}">${esc(r.description)}</a>` : esc(r.description)}</dd>
        <dt>Make &amp; model</dt><dd>${esc(r.makeModel || "—")}</dd>
        ${r.unitSerialNo ? `<dt>Unit / serial no.</dt><dd>${esc(r.unitSerialNo)}</dd>` : ""}${r.engineSerialNo ? `<dt>Engine serial no.</dt><dd>${esc(r.engineSerialNo)}</dd>` : ""}${r.plateNo ? `<dt>Plate no.</dt><dd>${esc(r.plateNo)}</dd>` : ""}
        <dt>End user</dt><dd>${esc(r.endUser || "—")}${r.designation ? ` · ${esc(r.designation)}` : ""}<div class="xs muted">${esc(r.office)}</div></dd>
        <dt>Job order</dt><dd>${esc(r.jobOrderNo)} · ${fmtDate(r.jobOrderDate)}</dd>
        <dt>Supplier</dt><dd>${esc(r.supplier || "—")}</dd>
        <dt>Invoice / PO</dt><dd>${esc(r.invoiceNo || "—")}${r.invoiceDate ? ` · ${fmtDate(r.invoiceDate)}` : ""}</dd>
        ${r.nature ? `<dt>Nature</dt><dd>${esc(r.nature)}</dd>` : ""}
        <dt>Recorded</dt><dd>${fmtDateTime(r.createdAt)} · ${esc(r.encodedBy?.name)}</dd>
        ${r.status === "verified" ? `<dt>Verified</dt><dd>${esc(r.verifiedBy?.name)} · ${fmtDateTime(r.reviewedAt)}</dd>` : ""}
      </dl>
      <div class="btn-row" style="margin-top:1rem"><button class="btn sm" id="pr">Print History of Repair</button>
        ${canEdit(r) ? `<a class="btn sm" href="#/repairs/${esc(r.id)}/edit">${r.status === "returned" ? "Correct and resend" : "Edit"}</a><button class="btn sm danger" id="del">Delete</button>` : ""}</div></div>
    </div></div>`;
  $("#pr", main).onclick = () => printForm(repairHistoryHtml(a, repairsOf(r.assetId)));
  $("#del", main) && ($("#del", main).onclick = async e => {
    if (!(await confirmBox({ title: `Delete the repair record for JO ${r.jobOrderNo}?`, confirmText: "Delete", danger: true }))) return;
    busy(e.target, async () => { await deleteRepair(r.id); location.hash = "#/repairs"; }, "Deleted.").catch(() => {});
  });
  const vf = $("#vf", main);
  if (vf) {
    // a completed review clears the "unsaved changes" state, so the page redraws with the new status
    vf.onsubmit = e => { e.preventDefault(); busy(e.submitter, async () => { await reviewRepair(r.id, true, vf.remarks.value.trim(), { name: vf.vName.value.trim(), position: vf.vPos.value.trim() }); clean(); }, "Repair verified and added to the item's history.").catch(() => {}); };
    $("#ret", main).onclick = e => { if (!vf.remarks.value.trim()) return toast("Write the reason in Remarks.", "err"); busy(e.target, async () => { await reviewRepair(r.id, false, vf.remarks.value.trim()); clean(); }, "Returned to the End-User.").catch(() => {}); };
  }
}
detail.deps = ["r:repairs", "r:assets"];

