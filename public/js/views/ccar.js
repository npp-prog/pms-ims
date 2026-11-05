// CAR — Completion and Acceptance Report: non-inventoriable goods and labor (services), as determined by
// the GSO. Made when the GSO inspects an End-User's Delivery Report (its non-inventoriable lines); the GSO can correct it,
// Accounting posts it. It never enters the inventory or the registries.
import { S, can, role, settings, airById } from "../state.js";
import { officeSelect, $, $$, esc, uid, busy, money, num, qty, fmtDate, manilaToday, opts, renderTable, confirmBox, B, downloadCSV } from "../ui.js";
import { FUNDS, fundName } from "../core/catalog.js";
import { CCAR_COMPONENTS, ccarLines, ccarTotals, validateCcar } from "../core/logic.js";
import { saveCcar, cancelCcar, setPosting, markCarRepairLines } from "../data.js";
import { printForm, ccarHtml } from "../print.js";
import { attachmentsCard } from "./attachments.js";
import { canRenumber, renumberDialog } from "./common.js";

const clean = () => window.dispatchEvent(new Event("app:clean"));
const ccarById = id => (S.d.ccars || []).find(c => c.id === id);
const badge = c => c.status === "cancelled" ? B("Cancelled", "b-dark") : c.posting?.posted ? B("Posted", "b-ok") : B("For Posting", "b-warn");

/* ---------------- list ---------------- */
export function list(main) {
  const enduser = role() === "enduser";
  const rows = (S.d.ccars || []).filter(c => enduser || c.fund === S.fund);
  main.innerHTML = `<div class="page-head"><div><h1>Completion and Acceptance Reports (CAR)</h1><p>Completion and Acceptance Reports for goods and labor / services the GSO finds
      <b>non-inventoriable</b>${enduser ? ` for ${esc(S.account?.office || "your office")}` : ` in the ${esc(fundName(S.fund))}`}. Every CAR starts from a Delivery Report: the GSO makes it when inspecting one. They never enter the inventory or the registries; Accounting posts each one with its JEV.</p></div>
    <div class="btn-row"><button class="btn" id="csv">CSV</button></div></div><div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "ccar", rows, pageSize: 50, defaultSort: 0, defaultDir: -1,
    searchText: c => `${c.number} ${c.supplier} ${c.office} ${c.purpose} ${(c.lines || []).map(l => l.description).join(" ")}`,
    filters: [{ key: "s", label: "Status", options: [["open", "For Posting"], ["posted", "Posted"], ["cancelled", "Cancelled"]],
      test: (c, v) => v === "cancelled" ? c.status === "cancelled" : c.status !== "cancelled" && !!c.posting?.posted === (v === "posted") }],
    columns: [
      { label: "Date", render: c => fmtDate(c.date), sort: c => c.date || "" },
      { label: "CAR No.", render: c => `<b>${esc(c.number)}</b>${c.fromAirId ? `<div class="xs muted">from a Delivery Report${c.fromAirNo ? ` (with AIR ${esc(c.fromAirNo)})` : ""}</div>` : ""}`, sort: c => c.number },
      { label: "Supplier / contractor", render: c => `${esc(c.supplier)}<div class="xs muted">${esc(c.purpose || "")}</div>`, sort: c => c.supplier },
      { label: "Office", render: c => esc(c.office), sort: c => c.office },
      { label: "Goods", render: c => num(c.goodsTotal), cls: "right", headCls: "right", sort: c => c.goodsTotal },
      { label: "Labor", render: c => num(c.laborTotal), cls: "right", headCls: "right", sort: c => c.laborTotal },
      { label: "Total", render: c => `<b>${money(c.total)}</b>`, cls: "right", headCls: "right", sort: c => c.total },
      { label: "Status", render: c => `${badge(c)}${c.posting?.posted ? `<div class="xs muted">${esc(c.posting.ref)}</div>` : ""}` }
    ],
    empty: "No CARs yet.",
    onRow: c => { location.hash = `#/car/${c.id}`; }
  });
  $("#csv", main).onclick = () => downloadCSV(`CAR-${S.fund}`, ["Fund", "CAR No.", "Date", "Supplier", "Office", "Component", "Description", "Unit", "Qty", "Unit Cost", "Amount", "Status", "JEV / Ref"],
    t.rows().flatMap(c => (c.lines || []).map(l => [c.fund, c.number, c.date, c.supplier, c.office, CCAR_COMPONENTS[l.component], l.description, l.unit, l.qty, l.unitCost, l.amount,
      c.status === "cancelled" ? "Cancelled" : c.posting?.posted ? "Posted" : "For Posting", c.posting?.ref || ""])));
}
list.deps = ["r:ccars", "fund"];

/* ---------------- form (GSO): corrections to a CAR made at inspection ---------------- */
export function form(main, [id]) {
  const c = ccarById(id), s = settings();
  if (!c) { main.innerHTML = `<div class="notice warn">CAR not found.</div>`; return; }
  if (c && (c.status !== "accepted" || c.posting?.posted)) { location.hash = `#/car/${id}`; return; }
  const src = c;
  let lines = (c.lines || []).map(l => ({ id: l.id || uid(), component: l.component || "goods", description: l.description, specs: l.specs || "", unit: l.unit, qty: l.qty, unitCost: l.unitCost }));
  if (!lines.length) lines = [{ id: uid(), component: "goods", unit: "", qty: 1 }];
  const v = c.verification || {}, a = c.acceptance || {}, r = c.receipt || {}, today = manilaToday();
  main.innerHTML = `<div class="page-head"><div><h1>Edit CAR ${esc(c.number)}</h1>
      <p>For goods and labor / services the GSO finds <b>non-inventoriable</b>: they are accepted and expensed here, and never enter the inventory or the registries. Accounting posts the CAR with its JEV.</p></div></div>
    <form id="cf" class="card" novalidate>
      <div class="grid g4">
        <div><label class="req">Fund</label><select name="fund" disabled>${opts(FUNDS.map(f => [f.code, f.name]), c.fund)}</select></div>
        <div><label class="req">CAR date</label><input type="date" name="date" value="${esc(c.date || today)}"></div>
        <div class="span2"><label class="req">Requisitioning office / department</label>${officeSelect("office", src.office || "", s.offices)}</div>
        <div class="span2"><label class="req">Supplier / contractor</label><input name="supplier" value="${esc(src.supplier || "")}"></div>
        <div><label>PO No.</label><input name="poNo" value="${esc(src.poNo || "")}"></div>
        <div><label>PO date</label><input type="date" name="poDate" value="${esc(src.poDate || "")}"></div>
        <div class="span2"><label>Invoice / DR No.</label><input name="invNo" value="${esc(src.invNo || "")}"></div>
        <div><label>Invoice date</label><input type="date" name="invDate" value="${esc(src.invDate || "")}"></div>
        <div></div>
        <div class="spanall"><label>Purpose / remarks</label><input name="purpose" value="${esc(src.purpose || "")}" placeholder="e.g. Repair of the Session Hall ceiling — materials and labor"></div>
      </div>
      <h3 style="margin-top:1.4rem">Goods and labor</h3>
      <p class="xs muted" style="margin-top:-.3rem">Choose <b>Goods</b> for materials and other non-inventoriable items, or <b>Labor / Services</b> for the work done. The totals of each are shown on the CAR.</p>
      <div class="table-wrap"><table class="lines"><thead><tr><th>Component</th><th>Description</th><th>Specifications</th><th>Unit</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Amount</th><th></th></tr></thead><tbody id="lb"></tbody>
        <tfoot><tr><td colspan="6" class="right">Goods / Labor / <b>Total</b></td><td class="tot" id="ltot"></td><td></td></tr></tfoot></table></div>
      <button type="button" class="btn sm" id="add" style="margin-top:.6rem">+ Add item</button>
      <h3 style="margin-top:1.4rem">Verification, acceptance and receipt</h3>
      <div class="grid g2 ccar-sign">
        <fieldset><legend>Verified by</legend>
          <label>Date verified</label><input type="date" name="vDate" value="${esc(v.date || today)}">
          <label class="check"><input type="checkbox" name="vOk" ${v.ok ? "checked" : ""}> Verified complete and in order as to quantity and specifications</label>
          <label>Name</label><input name="vName" value="${esc(v.name ?? (S.account?.displayName || ""))}">
          <label>Designation</label><input name="vPos" value="${esc(v.position ?? "General Services Officer")}"></fieldset>
        <fieldset><legend>Accepted and received by (End-User)</legend>
          <label>Date accepted / received</label><input type="date" name="rDate" value="${esc(r.date || today)}">
          <label class="check"><input type="radio" name="aStatus" value="complete" ${a.status !== "partial" ? "checked" : ""}> Complete</label>
          <label class="check"><input type="radio" name="aStatus" value="partial" ${a.status === "partial" ? "checked" : ""}> Partial (please specify)</label>
          <input name="aNote" value="${esc(a.partialNote || "")}" placeholder="What was partial">
          <label class="check"><input type="checkbox" name="rOk" ${r.ok ? "checked" : ""}> Received in good order and condition</label>
          <label>Name</label><input name="rName" value="${esc(r.name ?? "")}">
          <label>Designation / Office</label><input name="rPos" value="${esc(r.designation ?? "")}"></fieldset>
      </div>
      <div class="form-msg err" id="msg"></div>
      <div class="modal-actions"><a class="btn" href="#/car/${c.id}">Cancel</a><button type="submit" class="btn primary">Save changes</button></div>
    </form>`;
  const lb = $("#lb", main);
  const totals = () => { const t = ccarTotals(ccarLines(lines)); $("#ltot", main).innerHTML = `${num(t.goodsTotal)} / ${num(t.laborTotal)} / <b>${money(t.total)}</b>`; };
  const draw = () => {
    lb.innerHTML = lines.map((l, i) => `<tr data-i="${i}">
      <td><select data-k="component" class="w-sm">${opts(Object.entries(CCAR_COMPONENTS), l.component)}</select></td>
      <td><input data-k="description" class="w-lg" value="${esc(l.description || "")}" placeholder="${l.component === "labor" ? "e.g. Labor — installation of ceiling boards" : "e.g. Ceiling boards, 4×8"}"></td>
      <td><textarea data-k="specs" class="w-md">${esc(l.specs || "")}</textarea></td>
      <td><input data-k="unit" class="w-xs" value="${esc(l.unit || "")}" placeholder="${l.component === "labor" ? "lot" : "pc"}"></td>
      <td><input data-k="qty" type="number" min="0" step="any" class="w-xs" value="${esc(l.qty ?? "")}"></td>
      <td><input data-k="unitCost" type="number" min="0" step="0.01" class="w-sm" value="${esc(l.unitCost ?? "")}"></td>
      <td class="tot" data-amt>${num((Number(l.qty) || 0) * (Number(l.unitCost) || 0))}</td>
      <td><button type="button" class="btn sm ghost" data-rm title="Remove">✕</button></td></tr>`).join("");
    totals();
  };
  draw();
  lb.addEventListener("input", e => {
    const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return;
    const l = lines[+tr.dataset.i]; l[k] = e.target.value;
    $("[data-amt]", tr).textContent = num((Number(l.qty) || 0) * (Number(l.unitCost) || 0)); totals();
  });
  lb.addEventListener("click", e => { if (!e.target.closest("[data-rm]")) return; lines.splice(+e.target.closest("tr").dataset.i, 1); if (!lines.length) lines.push({ id: uid(), component: "goods", qty: 1 }); draw(); });
  $("#add", main).onclick = () => { lines.push({ id: uid(), component: lines.at(-1)?.component || "goods", unit: "", qty: 1 }); draw(); };
  $("#cf", main).onsubmit = e => {
    e.preventDefault();
    const f = $("#cf", main), v = Object.fromEntries(new FormData(f).entries());
    const data = { ...v, fund: c.fund, vOk: f.vOk.checked, rOk: f.rOk.checked, lines }; // the fund box is locked (the CAR No. belongs to its fund), so it is not in the form data
    const errs = validateCcar({ ...data, lines: ccarLines(lines), acceptance: { status: v.aStatus, partialNote: v.aNote } });
    if (errs.length) { $("#msg", main).textContent = errs[0]; return; }
    $("#msg", main).textContent = "";
    busy(e.submitter, async () => { const out = await saveCcar(c.id, data); clean(); location.hash = `#/car/${out.id}`; },
      "CAR saved.").catch(err => { $("#msg", main).textContent = err.message; });
  };
}
form.deps = ["r:ccars", "r:airs"];

/* ---------------- detail ---------------- */
export function detail(main, [id]) {
  const c = ccarById(id);
  if (!c) { main.innerHTML = `<div class="notice warn">CAR not found, or you don't have access to it.</div>`; return; }
  const open = c.status === "accepted" && !c.posting?.posted, v = c.verification || {}, a = c.acceptance || {}, r = c.receipt || {};
  const air = c.fromAirId ? airById(c.fromAirId) : null;
  // which items go to the History of Repair: marked by the End-Users of its office (or the GSO); a repair then picks this CAR
  const marked = new Set(c.repairLines || []), repair = (S.d.repairs || []).find(x => x.ccarId === c.id);
  const canMark = c.status === "accepted" && (can("issue") || (role() === "enduser" && !!S.account?.office && S.account.office === c.office));
  main.innerHTML = `<div class="page-head"><div><h1>CAR ${esc(c.number)}</h1><p>${esc(fundName(c.fund))} · ${esc(c.office)} · ${esc(c.supplier)} · non-inventoriable</p></div>
      <div class="btn-row">${badge(c)}</div></div>
    ${c.status === "cancelled" ? `<div class="notice bad"><b>Cancelled</b>${c.cancel?.reason ? ` — ${esc(c.cancel.reason)}` : ""}${c.fromAirId ? ". The Delivery Report went back to GSO inspection." : ""}</div>` : ""}
    <div class="split">
      <div>
        <div class="card"><div class="card-head"><h3>Goods and labor</h3><span class="small muted">Goods ${money(c.goodsTotal)} · Labor ${money(c.laborTotal)}</span></div>
          ${canMark ? `<p class="small muted" style="margin-top:0">Tick the items that go to the <b>History of Repair</b>, then save. When requesting the repair, choose this CAR.</p>` : ""}
          <div class="table-wrap"><table><thead><tr><th>Component</th><th>Description</th><th>Unit</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Amount</th><th>History of Repair${canMark ? `<label class="check" style="font-weight:500;margin-top:.2rem"><input type="checkbox" data-nodirty id="rlall" ${(c.lines || []).length && (c.lines || []).every(l => marked.has(l.id)) ? "checked" : ""}> Tick all</label>` : ""}</th></tr></thead>
          <tbody>${(c.lines || []).map(l => `<tr><td>${B(CCAR_COMPONENTS[l.component], l.component === "labor" ? "b-info" : "b-gold")}</td><td><b>${esc(l.description)}</b>${l.specs ? `<div class="xs muted">${esc(l.specs)}</div>` : ""}</td>
            <td>${esc(l.unit)}</td><td class="right">${qty(l.qty)}</td><td class="right">${num(l.unitCost)}</td><td class="right">${num(l.amount)}</td>
            <td>${canMark ? `<label class="check"><input type="checkbox" data-nodirty data-rl="${esc(l.id)}" ${marked.has(l.id) ? "checked" : ""}> Include</label>` : marked.has(l.id) ? B("Included", "b-ok") : ""}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="5" class="right">Total</td><td class="right">${money(c.total)}</td><td></td></tr></tfoot></table></div>
          ${canMark ? `<div class="btn-row end" style="margin-top:.6rem"><button class="btn sm primary" id="saverl">Save History of Repair items</button></div>` : ""}
          ${repair ? `<p class="small" style="margin-bottom:0">Included in the repair of <a href="#/repairs/${esc(repair.id)}">${esc(repair.propertyNo || repair.description)}${repair.jobOrderNo ? ` — JO ${esc(repair.jobOrderNo)}` : ""}</a>.</p>` : ""}</div>
        <div class="card"><h3>Verification, acceptance and receipt</h3><dl class="kv">
          <dt>Verified</dt><dd>${v.date ? fmtDate(v.date) : "—"} · ${esc(v.name || "—")}${v.ok ? " · complete and in order" : ""}</dd>
          <dt>Accepted and received</dt><dd>${r.date ? fmtDate(r.date) : "—"} · ${esc(r.name || "—")}${r.designation ? ` (${esc(r.designation)})` : ""} · ${a.status === "partial" ? `Partial — ${esc(a.partialNote)}` : a.status === "complete" ? "Complete" : "—"}${r.ok ? " · good order and condition" : ""}</dd></dl></div>
      </div>
      <div>
        <div class="card"><h3>Details</h3><dl class="kv">
          <dt>CAR date</dt><dd>${fmtDate(c.date)}</dd><dt>Supplier</dt><dd>${esc(c.supplier)}</dd>
          <dt>PO No./Date</dt><dd>${esc(c.poNo || "—")}${c.poDate ? " · " + fmtDate(c.poDate) : ""}</dd>
          <dt>Invoice No./Date</dt><dd>${esc(c.invNo || "—")}${c.invDate ? " · " + fmtDate(c.invDate) : ""}</dd>
          ${c.purpose ? `<dt>Purpose</dt><dd>${esc(c.purpose)}</dd>` : ""}
          ${c.fromAirId ? `<dt>From</dt><dd>${air ? `<a href="#/airs/${esc(c.fromAirId)}">${c.fromAirNo ? `Delivery Report with AIR ${esc(c.fromAirNo)}` : "the Delivery Report"}</a>` : "a Delivery Report"}${c.endUserName ? ` · ${esc(c.endUserName)}` : ""}</dd>` : ""}
          <dt>Accounting</dt><dd>${c.posting?.posted ? `Posted ${fmtDate(c.posting.date)} · ${esc(c.posting.ref)}` : c.status === "cancelled" ? "—" : "Not yet posted"}</dd>
          <dt>Prepared by</dt><dd>${esc(c.encodedBy?.name || "")}</dd></dl>
        <div class="btn-row" style="margin-top:1rem">
          <button class="btn sm" id="print">Print CAR</button>
          ${canRenumber(c) && c.status === "accepted" ? `<button class="btn sm" id="renum">Change CAR No.</button>` : ""}
          ${can("issue") && open ? `<a class="btn sm" href="#/car/${c.id}/edit">Edit</a>${!c.fromAirId || air?.status === "ccar" ? `<button class="btn sm danger" id="cx">Cancel CAR</button>` : ""}` : ""}
          ${can("post") && open ? `<a class="btn sm primary" href="#/posting">Post in For Posting</a>` : ""}
          ${can("post") && c.status === "accepted" && c.posting?.posted ? `<button class="btn sm danger" id="un">Unpost</button>` : ""}
        </div></div>
        <div id="att"></div>
      </div>
    </div>`;
  $("#print", main).onclick = () => printForm(ccarHtml(c));
  $("#renum", main) && ($("#renum", main).onclick = e => renumberDialog("ccar", c, "CAR", c.number, e.target));
  // Tick all: every item to the History of Repair (or none); it follows the boxes ticked one by one
  const allBox = $("#rlall", main), boxes = $$("[data-rl]", main);
  if (allBox) {
    allBox.onchange = () => boxes.forEach(b => { b.checked = allBox.checked; });
    boxes.forEach(b => b.addEventListener("change", () => { allBox.checked = boxes.every(x => x.checked); }));
  }
  $("#saverl", main) && ($("#saverl", main).onclick = e => busy(e.target, () => markCarRepairLines(c.id, $$("[data-rl]", main).filter(x => x.checked).map(x => x.dataset.rl)),
    "Saved — choose this CAR when requesting the repair.").catch(() => {}));
  attachmentsCard($("#att", main), { type: "ccar", id: c.id, office: c.office, fund: c.fund, label: `CAR ${c.number}` },
    { title: "Signed CAR and other attachments", labels: ["Signed CAR", "Photo", "Invoice", "Delivery receipt", "Purchase order", "Other"], defaultLabel: "Signed CAR",
      also: c.fromAirId ? [{ type: "air", id: c.fromAirId }] : [] });
  $("#cx", main) && ($("#cx", main).onclick = async e => {
    const x = await confirmBox({ title: `Cancel CAR ${c.number}?`, body: c.fromAirId ? "The Delivery Report it came from goes back to GSO inspection." : "", fields: [{ name: "reason", label: "Reason", required: true }], confirmText: "Cancel CAR", danger: true });
    if (x) busy(e.target, () => cancelCcar(c.id, x.reason), "CAR cancelled.").catch(() => {});
  });
  $("#un", main) && ($("#un", main).onclick = async e => {
    if (await confirmBox({ title: `Unpost CAR ${c.number}?`, body: "Use this only to correct a posting made in error.", confirmText: "Unpost", danger: true }))
      busy(e.target, () => setPosting("ccar", c.id, null), "Posting removed.").catch(() => {});
  });
}
detail.deps = ["r:ccars", "r:airs", "r:attachments", "r:repairs"];
