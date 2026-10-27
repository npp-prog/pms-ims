// Acceptance and Inspection Report: encoded by the End-User, inspected and approved (or returned) by the GSO.
import { S, can, role, settings, fundAirs, airById, docsOfAir } from "../state.js";
import {
  officeSelect, $, esc, uid, toast, busy, money, num, qty, fmtDate, fmtDateTime, manilaToday, opts, accountOpts, datalist,
  renderTable, confirmBox, openModal, airBadge, catBadge, docStatusBadge, postBadge, downloadCSV
} from "../ui.js";
import { FUNDS, fundName, CATEGORIES, ACCOUNTS_BY_CATEGORY, accountName } from "../core/catalog.js";
import { numberingFor, buildItemCatalog, findItem, AIR_STATUS, suggestCategory, lineAmount, linesTotal, remainingQty, postingSummary, stockCards, validateAir, suggestStockNo } from "../core/logic.js";
import { saveAir, deleteAir, approveAir, returnAir } from "../data.js";
import { printForm, airHtml } from "../print.js";
import { attachmentsCard } from "./attachments.js";
import { canRenumber, renumberDialog } from "./common.js";

const clean = () => window.dispatchEvent(new Event("app:clean"));

/* ---------------- lists ---------------- */
export function list(main) {
  const enduser = role() === "enduser";
  const mine = a => a.endUserUid === S.user.uid, office = S.account?.office || "";
  const rows = (enduser ? S.d.airs : fundAirs()).filter(a => enduser || a.status !== "draft");
  main.innerHTML = `<div class="page-head"><div><h1>${enduser ? "Office AIRs" : "Acceptance and Inspection Reports"}</h1>
      <p>${enduser ? `Every AIR of ${office ? `the <b>${esc(office)}</b>` : "your office"} — yours, including your drafts, and the ones your colleagues submitted. Encode each delivery you received; the GSO inspects it, then issues the PAR, ICS or RIS. You can edit only your own drafts and returned AIRs.` : `Every submitted AIR in the ${esc(fundName(S.fund))}. Drafts stay private to the End-User until submitted.`}</p></div>
      <div class="btn-row">${can("encodeAir") ? `<a class="btn primary" href="#/airs/new">New AIR</a>` : ""}<button class="btn" id="csv">Download CSV</button></div></div>
    <div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "airs-" + role(), rows, pageSize: 30, defaultSort: 0, defaultDir: -1,
    searchText: a => `${a.airNo} ${a.supplier} ${a.office} ${a.poNo} ${a.invNo} ${a.endUserName} ${(a.lines || []).map(l => l.description).join(" ")}`,
    searchPlaceholder: "AIR no., supplier, office, PO, item",
    filters: [{ key: "st", label: "Status", options: Object.entries(AIR_STATUS).filter(([k]) => enduser || k !== "draft"), test: (a, v) => a.status === v },
      ...(enduser ? [{ key: "f", label: "Fund", options: FUNDS.map(f => [f.code, f.name]), test: (a, v) => a.fund === v },
        { key: "w", label: "Encoded by", options: [["me", "Me"], ["others", "Others in my office"]], test: (a, v) => (v === "me") === mine(a) }] : [])],
    columns: [
      { label: "Date", render: a => fmtDate(a.date), sort: a => a.date || "" },
      { label: "AIR No.", render: a => `<b>${esc(a.airNo || (a.status === "draft" ? "Draft" : "—"))}</b>${enduser ? `<div class="xs muted">${esc(fundName(a.fund))}</div>` : ""}`, sort: a => a.airNo || "" },
      { label: "Supplier", render: a => esc(a.supplier), sort: a => a.supplier || "" },
      { label: "Office / End-User", render: a => `${esc(a.office)}<div class="xs muted">${enduser && mine(a) ? "<b>You</b>" : esc(a.endUserName)}</div>`, sort: a => a.office || "" },
      { label: "Items", render: a => (a.lines || []).length, cls: "right" },
      { label: "Amount", render: a => money(a.total), sort: a => a.total || 0, cls: "right", headCls: "right" },
      { label: "Status", render: a => airBadge(a.status), sort: a => a.status }
    ],
    empty: enduser ? "No AIR has been encoded for your office yet." : "No AIRs in this fund yet.",
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
      { label: "AIR No.", render: a => a.airNo ? `<b>${esc(a.airNo)}</b>` : `<span class="muted small">on approval</span>`, sort: a => a.airNo },
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
      <p>Encode the delivery exactly as on the supplier's invoice / delivery receipt. The GSO gives the AIR its number when inspecting and approving it.
        Attach the <b>photo</b> and the <b>invoice</b> on the AIR's page after saving it (as a draft or submitted).</p></div></div>
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
      <div class="table-wrap"><table class="lines"><thead><tr><th>Type</th><th>Description</th><th>Item No.</th><th>Specifications</th><th>Unit</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Amount</th><th>Becomes</th><th></th></tr></thead><tbody id="lb"></tbody>
        <tfoot><tr><td colspan="7" class="right">Total</td><td class="tot" id="ltot"></td><td colspan="2"></td></tr></tfoot></table></div>
      <button type="button" class="btn sm" id="add" style="margin-top:.6rem">+ Add item</button>
      <div class="form-msg err" id="msg"></div>
      <div class="modal-actions">
        ${a?.status === "draft" ? `<button type="button" class="btn danger" id="del">Delete draft</button>` : ""}
        <a class="btn" href="#/airs">Cancel</a>
        <button type="button" class="btn" id="draft">Save as draft</button>
        <button type="submit" class="btn primary">${a?.status === "returned" ? "Resubmit to GSO" : "Submit to GSO"}</button>
      </div>
    </form>`;
  // items already accepted before: typing a known description fills its Item No. (and unit / type when empty)
  let catalog = null, catSrc = null;
  const lists = () => {
    if (catSrc?.[0] === S.d.items && catSrc?.[1] === S.d.airs) return catalog;
    catalog = buildItemCatalog(S.d.items, S.d.airs); catSrc = [S.d.items, S.d.airs];
    $("#itemlist", main)?.remove(); $("#itemnos", main)?.remove();
    main.querySelector("#af").insertAdjacentHTML("beforeend", `<datalist id="itemlist">${[...catalog.values()].map(e => `<option value="${esc(e.description)}">${esc(e.stockNo ? `${e.stockNo} · ${e.unit}` : e.unit)}</option>`).join("")}</datalist>
      <datalist id="itemnos">${[...catalog.values()].filter(e => e.stockNo).map(e => `<option value="${esc(e.stockNo)}">${esc(e.description)}</option>`).join("")}</datalist>`);
    return catalog;
  };
  lists();
  main.querySelector("#af").addEventListener("focusin", e => { if (e.target.matches?.("[data-k=description], [data-k=stockNo]")) lists(); });
  const fillFromCatalog = (l, tr, typed) => {
    const catalog = lists();
    const hit = findItem(catalog, typed === "stockNo" ? { stockNo: l.stockNo } : { description: l.description });
    const set = (k, v) => { l[k] = v; const el = $(`[data-k=${k}]`, tr); if (el) el.value = v; };
    if (typed === "description") {
      if (hit?.stockNo && (!l.stockNo || l.autoNo)) { set("stockNo", hit.stockNo); l.autoNo = true; }
      else if (!hit && l.autoNo) { set("stockNo", ""); l.autoNo = false; }
    } else if (typed === "stockNo") {
      l.autoNo = false;
      if (hit && !String(l.description || "").trim()) set("description", hit.description);
    }
    const h = hit || (typed === "stockNo" ? findItem(catalog, { description: l.description }) : null);
    if (h) {
      if (h.unit && (!l.unitTouched || !String(l.unit || "").trim())) set("unit", h.unit);
      if (h.category && !l.kindTouched) set("kind", h.category === "cons" ? "supplies" : "equipment");
    }
    $("[data-hint]", tr).textContent = l.autoNo && l.stockNo ? "Item No. from earlier deliveries" : "";
  };
  const lb = $("#lb", main);
  const draw = () => {
    lb.innerHTML = lines.map((l, i) => `<tr data-i="${i}">
      <td><select data-k="kind" class="w-sm">${opts([["equipment", "Equipment"], ["supplies", "Supplies"]], l.kind)}</select></td>
      <td><input data-k="description" class="w-lg" list="itemlist" autocomplete="off" value="${esc(l.description || "")}" placeholder="e.g. Laptop computer"><div class="xs muted" data-hint>${l.autoNo ? "Item No. from earlier deliveries" : ""}</div></td>
      <td><input data-k="stockNo" class="w-sm" list="itemnos" autocomplete="off" value="${esc(l.stockNo || "")}" placeholder="auto"></td>
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
    if (k === "kind") l.kindTouched = true;
    if (k === "unit") l.unitTouched = true;
    if (k === "description") { l.unitTouched = false; l.kindTouched = false; } // a different item: its own unit and type
    if (k === "description" || k === "stockNo") fillFromCatalog(l, tr, k);
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
  main.innerHTML = `<div class="page-head"><div><h1>AIR ${esc(a.airNo || (a.status === "draft" ? "(draft)" : "— number on approval"))}</h1><p>${esc(fundName(a.fund))} · ${esc(a.office)} · encoded by ${esc(a.endUserName)}</p></div>
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
          ${a.airNo && canRenumber(a) ? `<button class="btn sm" id="renum">Change AIR No.</button>` : ""}
          ${owner && ["draft", "returned"].includes(a.status) ? `<a class="btn sm primary" href="#/airs/${a.id}/edit">${a.status === "returned" ? "Correct and resubmit" : "Edit / submit"}</a>` : ""}
          ${can("inspectAir") && a.status === "submitted" ? `<button class="btn sm primary" id="approve">Inspect &amp; approve</button><button class="btn sm danger" id="ret">Return to End-User</button>` : ""}
          ${can("issue") && a.status === "approved" ? `<a class="btn sm primary" href="#/issue/${a.id}">Issue PAR / ICS / RIS</a>` : ""}
          ${can("post") && issuedStage ? `<a class="btn sm" href="#/posting">Go to posting</a>` : ""}
        </div></div>
        <div id="att"></div>
        <div class="card"><h3>History</h3><ul class="timeline">${(a.history || []).slice().reverse().map(h => `<li class="done"><div>${esc(h.action)}${h.note ? ` — <i>${esc(h.note)}</i>` : ""}</div><div class="when">${fmtDateTime(h.at)} · ${esc(h.by)}</div></li>`).join("")}</ul></div>
      </div>
    </div>`;
  $("#print", main).onclick = () => printForm(airHtml(a));
  $("#renum", main) && ($("#renum", main).onclick = e => renumberDialog("air", a, "AIR", a.airNo, e.target));
  // Photo and invoice of the delivery: attached by the End-Users of the office (or the GSO / Accounting); once the GSO
  // gives the AIR its number, every file is shown and downloaded as "<AIR No.>-<document type>".
  const mineOffice = role() === "enduser" && S.account?.office && S.account.office === a.office;
  attachmentsCard($("#att", main), { type: "air", id: a.id, office: a.office, fund: a.fund, label: `AIR ${a.airNo || "(no number yet)"}` }, {
    title: "Photos and invoice", labels: ["Photo", "Invoice", "Delivery receipt", "Purchase order", "Other"], defaultLabel: "Photo",
    canAdd: mineOffice || can("issue") || can("post"), canRemove: x => can("issue") || can("post") || x.uploadedBy?.uid === S.user.uid, namePrefix: a.airNo || "",
    note: a.airNo ? "" : "Files are renamed to the AIR No. and the type of document once the GSO approves this AIR."
  });
  $("#ret", main) && ($("#ret", main).onclick = async e => {
    const v = await confirmBox({ title: "Return this AIR to the End-User?", body: "They can correct it and submit again.", fields: [{ name: "remarks", label: "Reason / what to correct", type: "textarea", required: true }], confirmText: "Return", danger: true });
    if (v) busy(e.target, () => returnAir(a.id, v.remarks), "AIR returned to the End-User.").catch(() => {});
  });
  $("#approve", main) && ($("#approve", main).onclick = () => inspectModal(a));
}
detail.deps = ["r:airs", "r:docs", "r:attachments"];

/* ---------------- GSO inspection ---------------- */
function inspectModal(a) {
  const s = settings(), th = s.thresholds;
  const known = stockCards(S.d.airs, S.d.docs, a.fund, "", { postedOnly: false }); // stock numbers already given, posted or not
  const lines = a.lines.map(l => ({ ...l, category: l.category || suggestCategory(l.kind, l.unitCost, th) }));
  // Stock No. of supplies: the GSO's own entry, or suggested from the Inventory Registry (re-suggested when the account changes)
  const suggest = () => {
    const taken = [];
    for (const l of lines) {
      if (l.category !== "cons") continue;
      if (!l.stockNo || l.autoStock) { l.stockNo = l.accountCode ? suggestStockNo(l, known, taken) : ""; l.autoStock = true; }
      taken.push(l.stockNo);
    }
  };
  suggest();
  const airManual = !a.airNo && numberingFor(S.settings, "air").mode === "manual";
  const m = openModal(`<h2>Inspect and approve ${a.airNo ? `AIR ${esc(a.airNo)}` : "the AIR"}</h2>
    ${a.airNo ? "" : `<div class="grid g3" style="margin-bottom:.8rem"><div><label class="${airManual ? "req" : ""}">AIR No.</label>${airManual ? `<input id="airno" placeholder="as on the printed AIR">` : `<input disabled value="Next in the series — given on approval">`}</div></div>`}
    <p class="muted small">Check each item against the delivery and correct it if needed (description, specifications, unit, quantity, unit cost). Confirm its classification: it decides which document is issued (PAR for PPE, ICS for Semi-Expendable, RIS for supplies) and the account Accounting posts to. Stock numbers of supplies are suggested from the Inventory Registry.</p>
    <div class="table-wrap"><table class="lines"><thead><tr><th>Item</th><th>Unit</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Amount</th><th>Classification</th><th>Account</th><th>Stock No. / Property No.</th><th>Useful life</th></tr></thead><tbody id="il"></tbody>
      <tfoot><tr><td colspan="4" class="right">Total</td><td class="tot" id="itot"></td><td colspan="4"></td></tr></tfoot></table></div>
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
    il.innerHTML = lines.map((l, i) => `<tr data-i="${i}"><td><input data-k="description" class="w-lg" value="${esc(l.description)}"><textarea data-k="specs" class="w-lg" placeholder="Specifications" style="margin-top:.25rem">${esc(l.specs || "")}</textarea></td>
      <td><input data-k="unit" class="w-xs" value="${esc(l.unit)}"></td>
      <td><input data-k="qty" type="number" min="0" step="any" class="w-xs" value="${esc(l.qty)}"></td><td><input data-k="unitCost" type="number" min="0" step="0.01" class="w-sm" value="${esc(l.unitCost)}"></td>
      <td class="right" data-amt>${num(lineAmount(l))}</td>
      <td><select data-k="category" class="w-md">${opts(Object.entries(CATEGORIES).map(([k, c]) => [k, c.short]), l.category)}</select></td>
      <td><select data-k="accountCode" class="w-lg">${accountOpts(ACCOUNTS_BY_CATEGORY[l.category] || [], l.accountCode)}</select></td>
      <td>${l.category === "cons" ? `<input data-k="stockNo" class="w-md" list="stocknos" value="${esc(l.stockNo || "")}" placeholder="Stock No.">${l.autoStock && l.stockNo ? `<div class="xs muted">suggested</div>` : ""}` : `<input data-k="propertyNo" class="w-md" value="${esc(l.propertyNo || "")}" placeholder="Optional; can be set on the PAR/ICS">`}</td>
      <td>${l.category === "cons" ? "" : `<input data-k="usefulLife" class="w-sm" value="${esc(l.usefulLife || "")}" placeholder="e.g. 5 years">`}</td></tr>`).join("");
  };
  const total = () => { $("#itot", m).textContent = money(lines.reduce((t, l) => t + lineAmount(l), 0)); };
  draw(); total();
  il.addEventListener("change", e => {
    const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return;
    const l = lines[+tr.dataset.i]; l[k] = e.target.value;
    if (k === "stockNo") l.autoStock = false;
    if (k === "category") { l.accountCode = ""; suggest(); draw(); }
    if (k === "accountCode" || k === "description") { suggest(); draw(); }
  });
  il.addEventListener("input", e => {
    const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k || !["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    const l = lines[+tr.dataset.i]; l[k] = e.target.value;
    if (k === "stockNo") l.autoStock = false;
    if (k === "qty" || k === "unitCost") { $("[data-amt]", tr).textContent = num(lineAmount(l)); total(); }
  });
  $("[data-x]", m).onclick = () => m.close();
  $("#ok", m).onclick = e => {
    const insp = {
      lines: lines.map(l => ({ id: l.id, description: l.description, specs: l.specs || "", unit: l.unit, qty: l.qty, unitCost: l.unitCost,
        category: l.category, accountCode: l.accountCode, stockNo: l.stockNo || "", propertyNo: l.propertyNo || "", usefulLife: l.usefulLife || "" })),
      inspection: { dateInspected: $("#di", m).value, inspectorName: $("#iname", m).value.trim(), inspectedOk: $("#iok", m).checked },
      acceptance: { dateReceived: $("#dr", m).value, status: $("#acc", m).value, partialNote: $("#pn", m).value.trim(), custodianName: $("#cust", m).value.trim() },
      remarks: $("#rem", m).value.trim(),
      airNo: $("#airno", m)?.value.trim() || ""
    };
    if (airManual && !insp.airNo) { $("#im", m).textContent = "Enter the AIR No. — numbering is set to manual."; return; }
    $("#im", m).textContent = "";
    busy(e.target, async () => {
      try { await approveAir(a.id, insp); m.close(); }
      catch (err) { $("#im", m).textContent = err.message; throw err; }
    }, "AIR approved. You can now issue the PAR, ICS or RIS.").catch(() => {});
  };
}

