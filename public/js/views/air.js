// Acceptance and Inspection Report: encoded by the End-User, inspected and approved (or returned) by the GSO.
import { S, can, role, settings, fundAirs, airById, docsOfAir } from "../state.js";
import {
  officeSelect, $, esc, uid, toast, busy, money, num, qty, fmtDate, fmtDateTime, manilaToday, opts, accountOpts, datalist,
  renderTable, confirmBox, openModal, airBadge, catBadge, docStatusBadge, postBadge, downloadCSV
} from "../ui.js";
import { FUNDS, fundName, CATEGORIES, ACCOUNTS_BY_CATEGORY, accountName } from "../core/catalog.js";
import { AIR_STATUS, suggestCategory, lineAmount, linesTotal, remainingQty, postingSummary, stockCards, validateAir } from "../core/logic.js";
import { saveAir, deleteAir, approveAir, returnAir } from "../data.js";
import { printForm, airHtml } from "../print.js";

const clean = () => window.dispatchEvent(new Event("app:clean"));

/* ---------------- lists ---------------- */
export function list(main) {
  const enduser = role() === "enduser";
  const rows = (enduser ? S.d.airs.filter(a => a.endUserUid === S.user.uid) : fundAirs())
    .filter(a => enduser || a.status !== "draft");
  main.innerHTML = `<div class="page-head"><div><h1>${enduser ? "My Acceptance and Inspection Reports" : "Acceptance and Inspection Reports"}</h1>
      <p>${enduser ? "Encode each delivery you received. The GSO inspects it, then issues the PAR, ICS or RIS." : `Every submitted AIR in the ${esc(fundName(S.fund))}. Drafts stay private to the End-User until submitted.`}</p></div>
      <div class="btn-row">${can("encodeAir") ? `<a class="btn primary" href="#/airs/new">New AIR</a>` : ""}<button class="btn" id="csv">Download CSV</button></div></div>
    <div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "airs-" + role(), rows, pageSize: 30, defaultSort: 0, defaultDir: -1,
    searchText: a => `${a.airNo} ${a.supplier} ${a.office} ${a.poNo} ${a.invNo} ${a.endUserName} ${(a.lines || []).map(l => l.description).join(" ")}`,
    searchPlaceholder: "AIR no., supplier, office, PO, item",
    filters: [{ key: "st", label: "Status", options: Object.entries(AIR_STATUS).filter(([k]) => enduser || k !== "draft"), test: (a, v) => a.status === v },
      ...(enduser ? [{ key: "f", label: "Fund", options: FUNDS.map(f => [f.code, f.name]), test: (a, v) => a.fund === v }] : [])],
    columns: [
      { label: "Date", render: a => fmtDate(a.date), sort: a => a.date || "" },
      { label: "AIR No.", render: a => `<b>${esc(a.airNo || "—")}</b>${enduser ? `<div class="xs muted">${esc(fundName(a.fund))}</div>` : ""}`, sort: a => a.airNo || "" },
      { label: "Supplier", render: a => esc(a.supplier), sort: a => a.supplier || "" },
      { label: "Office / End-User", render: a => `${esc(a.office)}<div class="xs muted">${esc(a.endUserName)}</div>`, sort: a => a.office || "" },
      { label: "Items", render: a => (a.lines || []).length, cls: "right" },
      { label: "Amount", render: a => money(a.total), sort: a => a.total || 0, cls: "right", headCls: "right" },
      { label: "Status", render: a => airBadge(a.status), sort: a => a.status }
    ],
    empty: enduser ? "You have not encoded any AIR yet." : "No AIRs in this fund yet.",
    onRow: a => { location.hash = `#/airs/${a.id}`; }
  });
  $("#csv", main).onclick = () => downloadCSV(`AIR-${S.fund}`, ["Fund", "AIR No.", "Date", "Supplier", "PO No.", "Invoice No.", "Office", "End-User", "Item", "Unit", "Qty", "Unit Cost", "Amount", "Category", "Account", "Issued Qty", "Status"],
    t.rows().flatMap(a => (a.lines || []).map(l => [a.fund, a.airNo, a.date, a.supplier, a.poNo, a.invNo, a.office, a.endUserName, l.description, l.unit, l.qty, l.unitCost, l.amount, CATEGORIES[l.category]?.short || "", l.accountCode, l.issuedQty || 0, AIR_STATUS[a.status]])));
}
list.deps = ["r:airs", "fund"];

export function inspectQueue(main) {
  const rows = fundAirs().filter(a => a.status === "submitted").sort((a, b) => (a.submittedAt?.seconds || 0) - (b.submittedAt?.seconds || 0));
  main.innerHTML = `<div class="page-head"><div><h1>For Inspection</h1><p>AIRs submitted by End-Users in the ${esc(fundName(S.fund))}. Open one to record the inspection and acceptance, classify each item and approve it — or return it with remarks.</p></div></div><div class="card" id="t"></div>`;
  renderTable($("#t", main), {
    id: "inspect", rows, pageSize: 30,
    searchText: a => `${a.airNo} ${a.supplier} ${a.office} ${a.endUserName}`,
    columns: [
      { label: "Submitted", render: a => fmtDateTime(a.submittedAt), sort: a => a.submittedAt?.seconds || 0 },
      { label: "AIR No.", render: a => `<b>${esc(a.airNo)}</b>`, sort: a => a.airNo },
      { label: "Supplier", render: a => esc(a.supplier) },
      { label: "Office / End-User", render: a => `${esc(a.office)}<div class="xs muted">${esc(a.endUserName)}</div>` },
      { label: "Amount", render: a => money(a.total), cls: "right", headCls: "right" }
    ],
    empty: "Nothing waiting for inspection.",
    onRow: a => { location.hash = `#/airs/${a.id}`; }
  });
}
inspectQueue.deps = ["r:airs", "fund"];

/* ---------------- End-User form ---------------- */
export function form(main, [id]) {
  const a = id ? airById(id) : null;
  if (id && !a) { main.innerHTML = `<div class="notice warn">AIR not found.</div>`; return; }
  if (a && (a.endUserUid !== S.user.uid || !["draft", "returned"].includes(a.status))) { location.hash = `#/airs/${id}`; return; }
  const th = settings().thresholds;
  let lines = a ? a.lines.map(l => ({ ...l })) : [{ id: uid(), kind: "equipment", unit: "unit", qty: 1 }];
  main.innerHTML = `<div class="page-head"><div><h1>${a ? `Edit AIR ${esc(a.airNo || "(draft)")}` : "New Acceptance and Inspection Report"}</h1>
      <p>Encode the delivery exactly as on the supplier's invoice / delivery receipt. The AIR number is assigned when you submit it to the GSO.</p></div></div>
    ${a?.status === "returned" && a.gsoRemarks ? `<div class="notice bad"><b>Returned by the GSO:</b> ${esc(a.gsoRemarks)}</div>` : ""}
    <form id="af" class="card" novalidate>
      <div class="grid g4">
        <div><label class="req">Fund</label><select name="fund" ${a?.airNo ? "disabled title=\"The AIR number already belongs to this fund\"" : ""}>${opts(FUNDS.map(f => [f.code, f.name]), a?.fund || S.fund)}</select></div>
        <div><label class="req">AIR date</label><input type="date" name="date" value="${esc(a?.date || manilaToday())}"></div>
        <div class="span2"><label class="req">Requisitioning office / department</label>${officeSelect("office", a?.office ?? S.account?.office ?? "", settings().offices)}</div>
        <div class="span2"><label class="req">Supplier</label><input name="supplier" value="${esc(a?.supplier || "")}"></div>
        <div><label>PO No.</label><input name="poNo" value="${esc(a?.poNo || "")}"></div>
        <div><label>PO date</label><input type="date" name="poDate" value="${esc(a?.poDate || "")}"></div>
        <div class="span2"><label>Invoice / DR No.</label><input name="invNo" value="${esc(a?.invNo || "")}"></div>
        <div><label>Invoice date</label><input type="date" name="invDate" value="${esc(a?.invDate || "")}"></div>
        <div></div>
        <div class="spanall"><label>Purpose / remarks</label><input name="purpose" value="${esc(a?.purpose || "")}" placeholder="e.g. For use of the Municipal Health Office"></div>
      </div>
      <h3 style="margin-top:1.4rem">Items delivered</h3>
      <p class="xs muted" style="margin-top:-.3rem">Choose <b>Equipment / furniture</b> for property (unit cost ₱${num(th.capitalization)} and up becomes PPE with a PAR; below that, Semi-Expendable with an ICS) or <b>Supplies</b> for consumable / distributable items (issued with a RIS). The GSO confirms the classification.</p>
      <div class="table-wrap"><table class="lines"><thead><tr><th>Type</th><th>Description</th><th>Specifications</th><th>Unit</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Amount</th><th>Becomes</th><th></th></tr></thead><tbody id="lb"></tbody>
        <tfoot><tr><td colspan="6" class="right">Total</td><td class="tot" id="ltot"></td><td colspan="2"></td></tr></tfoot></table></div>
      <button type="button" class="btn sm" id="add" style="margin-top:.6rem">+ Add item</button>
      <div class="form-msg err" id="msg"></div>
      <div class="modal-actions">
        ${a?.status === "draft" ? `<button type="button" class="btn danger" id="del">Delete draft</button>` : ""}
        <a class="btn" href="#/airs">Cancel</a>
        <button type="button" class="btn" id="draft">Save as draft</button>
        <button type="submit" class="btn primary">${a?.status === "returned" ? "Resubmit to GSO" : "Submit to GSO"}</button>
      </div>
    </form>`;
  const lb = $("#lb", main);
  const draw = () => {
    lb.innerHTML = lines.map((l, i) => `<tr data-i="${i}">
      <td><select data-k="kind" class="w-sm">${opts([["equipment", "Equipment"], ["supplies", "Supplies"]], l.kind)}</select></td>
      <td><input data-k="description" class="w-lg" value="${esc(l.description || "")}" placeholder="e.g. Laptop computer"></td>
      <td><textarea data-k="specs" class="w-md" placeholder="Brand, model, serial…">${esc(l.specs || "")}</textarea></td>
      <td><input data-k="unit" class="w-xs" value="${esc(l.unit || "")}"></td>
      <td><input data-k="qty" type="number" min="0" step="any" class="w-xs" value="${esc(l.qty ?? "")}"></td>
      <td><input data-k="unitCost" type="number" min="0" step="0.01" class="w-sm" value="${esc(l.unitCost ?? "")}"></td>
      <td class="tot" data-amt>${num(lineAmount(l))}</td>
      <td data-cat>${catBadge(suggestCategory(l.kind, l.unitCost, th))}</td>
      <td><button type="button" class="btn sm ghost" data-rm title="Remove">✕</button></td></tr>`).join("");
    $("#ltot", main).textContent = money(linesTotal(lines));
  };
  draw();
  lb.addEventListener("input", e => {
    const tr = e.target.closest("tr"); const k = e.target.dataset.k; if (!tr || !k) return;
    const l = lines[+tr.dataset.i]; l[k] = e.target.value;
    $("[data-amt]", tr).textContent = num(lineAmount(l));
    $("[data-cat]", tr).innerHTML = catBadge(suggestCategory(l.kind, l.unitCost, th));
    $("#ltot", main).textContent = money(linesTotal(lines));
  });
  lb.addEventListener("click", e => { if (!e.target.closest("[data-rm]")) return; lines.splice(+e.target.closest("tr").dataset.i, 1); if (!lines.length) lines.push({ id: uid(), kind: "equipment", qty: 1 }); draw(); });
  $("#add", main).onclick = () => { lines.push({ id: uid(), kind: lines.at(-1)?.kind || "equipment", unit: lines.at(-1)?.unit || "", qty: 1 }); draw(); };
  const collect = () => ({ ...Object.fromEntries(new FormData($("#af", main)).entries()), ...(a?.airNo ? { fund: a.fund } : {}), lines: lines.filter(l => String(l.description || "").trim() || Number(l.unitCost)) });
  const save = (btn, submit) => {
    const data = collect();
    $("#msg", main).textContent = "";
    if (submit) { const errs = validateAir({ ...data, lines: data.lines.map(l => ({ ...l, qty: Number(l.qty), unitCost: l.unitCost === "" ? "" : Number(l.unitCost) })) }); if (errs.length) { $("#msg", main).textContent = errs[0]; return; } }
    busy(btn, async () => {
      const newId = await saveAir(a?.id, data, submit);
      clean(); toast(submit ? "AIR submitted to the GSO for inspection." : "Draft saved.", "ok");
      location.hash = `#/airs/${newId}`;
    }).catch(() => {});
  };
  $("#af", main).onsubmit = e => { e.preventDefault(); save(e.submitter || $("[type=submit]", main), true); };
  $("#draft", main).onclick = e => save(e.target, false);
  $("#del", main) && ($("#del", main).onclick = async e => {
    if (!(await confirmBox({ title: "Delete this draft AIR?", body: "This cannot be undone.", confirmText: "Delete", danger: true }))) return;
    busy(e.target, async () => { await deleteAir(a.id); clean(); location.hash = "#/airs"; }, "Draft deleted.").catch(() => {});
  });
}
form.deps = [];

/* ---------------- detail ---------------- */
export function detail(main, [id]) {
  const a = airById(id);
  if (!a) { main.innerHTML = `<div class="notice warn">AIR not found, or you don't have access to it.</div>`; return; }
  const owner = a.endUserUid === S.user.uid;
  const docs = docsOfAir(a.id).sort((x, y) => (x.createdAt?.seconds || 0) - (y.createdAt?.seconds || 0));
  const ps = postingSummary(a, docs);
  const issuedStage = ["approved", "issued"].includes(a.status);
  const steps = [
    ["Encoded", a.status !== "draft" ? "done" : "now", a.endUserName],
    ["GSO inspection", a.status === "returned" ? "bad" : issuedStage ? "done" : a.status === "submitted" ? "now" : "", a.status === "returned" ? "Returned" : a.inspection?.inspectorName || ""],
    ["Issuance", a.status === "issued" ? "done" : a.status === "approved" ? "now" : "", `${docs.filter(d => d.status !== "cancelled").length} document(s)`],
    ["Accounting posting", ps.state === "posted" ? "done" : issuedStage && ps.total ? "now" : "", `${ps.posted} of ${ps.total} posted`]
  ];
  main.innerHTML = `<div class="page-head"><div><h1>AIR ${esc(a.airNo || "(draft)")}</h1><p>${esc(fundName(a.fund))} · ${esc(a.office)} · encoded by ${esc(a.endUserName)}</p></div>
      <div class="btn-row">${airBadge(a.status)} ${issuedStage ? postBadge(ps.state) : ""}</div></div>
    <div class="steps">${steps.map(([t, c, s]) => `<div class="${c}"><b>${esc(t)}</b>${esc(s || "")}</div>`).join("")}</div>
    ${a.status === "returned" && a.gsoRemarks ? `<div class="notice bad"><b>Returned by the GSO:</b> ${esc(a.gsoRemarks)}</div>` : ""}
    <div class="split">
      <div>
        <div class="card"><div class="card-head"><h3>Items</h3><span class="small muted">Total ${money(a.total)}</span></div>
          <div class="table-wrap"><table><thead><tr><th>Description</th><th>Unit</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Amount</th><th>Classification</th>${issuedStage ? `<th class="right">To issue</th>` : ""}</tr></thead>
          <tbody>${(a.lines || []).map(l => `<tr><td><b>${esc(l.description)}</b>${l.specs ? `<div class="xs muted">${esc(l.specs)}</div>` : ""}${l.stockNo ? `<div class="xs">Stock No. ${esc(l.stockNo)}</div>` : ""}</td>
            <td>${esc(l.unit)}</td><td class="right">${qty(l.qty)}</td><td class="right">${num(l.unitCost)}</td><td class="right">${num(l.amount)}</td>
            <td>${l.category ? `${catBadge(l.category)}<div class="xs muted">${esc(l.accountCode)} ${esc(accountName(l.accountCode))}</div>` : `<span class="xs muted">Proposed: ${esc(CATEGORIES[suggestCategory(l.kind, l.unitCost, settings().thresholds)].short)}</span>`}</td>
            ${issuedStage ? `<td class="right">${remainingQty(l) > 0 ? `<b>${qty(remainingQty(l))}</b>` : `<span class="badge b-ok">Issued</span>`}</td>` : ""}</tr>`).join("")}</tbody></table></div></div>
        ${docs.length ? `<div class="card"><div class="card-head"><h3>Documents issued from this AIR</h3></div>
          <div class="table-wrap"><table><thead><tr><th>Document</th><th>Date</th><th>Received by</th><th class="right">Amount</th><th>Accounting</th></tr></thead>
          <tbody>${docs.map(d => `<tr class="click" onclick="location.hash='#/issuances/${d.id}'"><td><b>${esc(d.docType.toUpperCase())} ${esc(d.number)}</b></td><td>${fmtDate(d.date)}</td><td>${esc(d.recipient?.name)}</td><td class="right">${money(d.total)}</td>
            <td>${docStatusBadge(d)}${d.posting?.posted ? `<div class="xs muted">${esc(d.posting.ref)} · ${fmtDate(d.posting.date)}</div>` : ""}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      </div>
      <div>
        <div class="card"><h3>Details</h3><dl class="kv">
          <dt>AIR date</dt><dd>${fmtDate(a.date)}</dd><dt>Supplier</dt><dd>${esc(a.supplier)}</dd>
          <dt>PO No./Date</dt><dd>${esc(a.poNo || "—")}${a.poDate ? " · " + fmtDate(a.poDate) : ""}</dd>
          <dt>Invoice No./Date</dt><dd>${esc(a.invNo || "—")}${a.invDate ? " · " + fmtDate(a.invDate) : ""}</dd>
          ${a.purpose ? `<dt>Purpose</dt><dd>${esc(a.purpose)}</dd>` : ""}
          ${a.inspection ? `<dt>Inspected</dt><dd>${fmtDate(a.inspection.dateInspected)} · ${esc(a.inspection.inspectorName || "")}</dd>
          <dt>Received</dt><dd>${fmtDate(a.acceptance?.dateReceived)} · ${a.acceptance?.status === "partial" ? `Partial — ${esc(a.acceptance.partialNote)}` : "Complete"}</dd>` : ""}
          ${(a.lines || []).some(l => l.category === "cons") && issuedStage ? `<dt>Supply receipt</dt><dd>${a.posting?.posted ? `Posted · ${esc(a.posting.ref)} · ${fmtDate(a.posting.date)}` : "Not yet posted by Accounting"}</dd>` : ""}
        </dl>
        <div class="btn-row" style="margin-top:1rem" id="acts">
          <button class="btn sm" id="print">Print AIR</button>
          ${owner && ["draft", "returned"].includes(a.status) ? `<a class="btn sm primary" href="#/airs/${a.id}/edit">${a.status === "returned" ? "Correct and resubmit" : "Edit / submit"}</a>` : ""}
          ${can("inspectAir") && a.status === "submitted" ? `<button class="btn sm primary" id="approve">Inspect &amp; approve</button><button class="btn sm danger" id="ret">Return to End-User</button>` : ""}
          ${can("issue") && a.status === "approved" ? `<a class="btn sm primary" href="#/issue/${a.id}">Issue PAR / ICS / RIS</a>` : ""}
          ${can("post") && issuedStage ? `<a class="btn sm" href="#/posting">Go to posting</a>` : ""}
        </div></div>
        <div class="card"><h3>History</h3><ul class="timeline">${(a.history || []).slice().reverse().map(h => `<li class="done"><div>${esc(h.action)}${h.note ? ` — <i>${esc(h.note)}</i>` : ""}</div><div class="when">${fmtDateTime(h.at)} · ${esc(h.by)}</div></li>`).join("")}</ul></div>
      </div>
    </div>`;
  $("#print", main).onclick = () => printForm(airHtml(a));
  $("#ret", main) && ($("#ret", main).onclick = async e => {
    const v = await confirmBox({ title: "Return this AIR to the End-User?", body: "They can correct it and submit again.", fields: [{ name: "remarks", label: "Reason / what to correct", type: "textarea", required: true }], confirmText: "Return", danger: true });
    if (v) busy(e.target, () => returnAir(a.id, v.remarks), "AIR returned to the End-User.").catch(() => {});
  });
  $("#approve", main) && ($("#approve", main).onclick = () => inspectModal(a));
}
detail.deps = ["r:airs", "r:docs"];

/* ---------------- GSO inspection ---------------- */
function inspectModal(a) {
  const s = settings(), th = s.thresholds;
  const known = stockCards(S.d.airs, S.d.docs, a.fund);
  const lines = a.lines.map(l => ({ ...l, category: l.category || suggestCategory(l.kind, l.unitCost, th),
    stockNo: l.stockNo || (known.find(c => c.description.toLowerCase() === String(l.description).toLowerCase())?.stockNo || "") }));
  const m = openModal(`<h2>Inspect and approve AIR ${esc(a.airNo)}</h2>
    <p class="muted small">Confirm the classification of each item: it decides which document is issued (PAR for PPE, ICS for Semi-Expendable, RIS for supplies) and the account Accounting posts to.</p>
    <div class="table-wrap"><table class="lines"><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit cost</th><th>Classification</th><th>Account</th><th>Stock No. / Property No.</th><th>Useful life</th></tr></thead><tbody id="il"></tbody></table></div>
    ${datalist("stocknos", known.map(c => c.stockNo))}
    <div class="grid g2" style="margin-top:1rem">
      <fieldset><legend>Inspection</legend><div class="grid">
        <div><label class="req">Date inspected</label><input type="date" id="di" value="${manilaToday()}"></div>
        <div><label>Inspection Officer / Committee</label><input id="iname" value="${esc(s.signatories.inspector || S.account?.displayName || "")}"></div>
        <label class="check"><input type="checkbox" id="iok" checked> Inspected, verified and found in order as to quantity and specifications</label></div></fieldset>
      <fieldset><legend>Acceptance</legend><div class="grid">
        <div><label class="req">Date received</label><input type="date" id="dr" value="${esc(a.date || manilaToday())}"></div>
        <div><label>Status</label><select id="acc">${opts([["complete", "Complete"], ["partial", "Partial"]], "complete")}</select></div>
        <div><label>If partial, specify</label><input id="pn"></div>
        <div><label>Supply and/or Property Custodian</label><input id="cust" value="${esc(s.signatories.propertyCustodian || "")}"></div></div></fieldset>
    </div>
    <div><label>Remarks (optional)</label><input id="rem"></div>
    <div class="form-msg err" id="im"></div>
    <div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="ok">Approve AIR</button></div>`, { size: "wide" });
  const il = $("#il", m);
  const draw = () => {
    il.innerHTML = lines.map((l, i) => `<tr data-i="${i}"><td><b>${esc(l.description)}</b><div class="xs muted">${esc(l.unit)} · ${num(l.amount)}</div></td>
      <td class="right">${qty(l.qty)}</td><td class="right">${num(l.unitCost)}</td>
      <td><select data-k="category" class="w-md">${opts(Object.entries(CATEGORIES).map(([k, c]) => [k, c.short]), l.category)}</select></td>
      <td><select data-k="accountCode" class="w-lg">${accountOpts(ACCOUNTS_BY_CATEGORY[l.category] || [], l.accountCode)}</select></td>
      <td>${l.category === "cons" ? `<input data-k="stockNo" class="w-md" list="stocknos" value="${esc(l.stockNo || "")}" placeholder="Stock No.">` : `<input data-k="propertyNo" class="w-md" value="${esc(l.propertyNo || "")}" placeholder="Optional; can be set on the PAR/ICS">`}</td>
      <td>${l.category === "cons" ? "" : `<input data-k="usefulLife" class="w-sm" value="${esc(l.usefulLife || "")}" placeholder="e.g. 5 years">`}</td></tr>`).join("");
  };
  draw();
  il.addEventListener("change", e => {
    const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return;
    const l = lines[+tr.dataset.i]; l[k] = e.target.value;
    if (k === "category") { l.accountCode = ""; draw(); }
  });
  il.addEventListener("input", e => { const tr = e.target.closest("tr"), k = e.target.dataset.k; if (tr && k && e.target.tagName === "INPUT") lines[+tr.dataset.i][k] = e.target.value; });
  $("[data-x]", m).onclick = () => m.close();
  $("#ok", m).onclick = e => {
    const insp = {
      lines: lines.map(l => ({ id: l.id, category: l.category, accountCode: l.accountCode, stockNo: l.stockNo || "", propertyNo: l.propertyNo || "", usefulLife: l.usefulLife || "" })),
      inspection: { dateInspected: $("#di", m).value, inspectorName: $("#iname", m).value.trim(), inspectedOk: $("#iok", m).checked },
      acceptance: { dateReceived: $("#dr", m).value, status: $("#acc", m).value, partialNote: $("#pn", m).value.trim(), custodianName: $("#cust", m).value.trim() },
      remarks: $("#rem", m).value.trim()
    };
    $("#im", m).textContent = "";
    busy(e.target, async () => {
      try { await approveAir(a.id, insp); m.close(); }
      catch (err) { $("#im", m).textContent = err.message; throw err; }
    }, "AIR approved. You can now issue the PAR, ICS or RIS.").catch(() => {});
  };
}

