// GSO issuance: PAR (PPE), ICS (Semi-Expendable) and RIS (supplies) issued from approved AIRs.
import { S, can, role, settings, fundAirs, fundDocs, airById, docById, activeUsers } from "../state.js";
import {
  $, $$, esc, toast, busy, money, num, qty, fmtDate, fmtDateTime, manilaToday, renderTable, confirmBox,
  docStatusBadge, downloadCSV, officeSelect
} from "../ui.js";
import { fundName, DOC_TYPES, CATEGORIES, accountName, FUNDS, isDistributionAccount } from "../core/catalog.js";
import { remainingQty, sxClass, numberingFor, suggestPropertyNos, propertyNoPrefix } from "../core/logic.js";
import { defaultLife } from "../core/assets.js";
import { issueDocs, cancelDoc } from "../data.js";
import { printForm, docHtml } from "../print.js";
import { attachmentsCard, attachmentsOf } from "./attachments.js";
import { canRenumber, renumberDialog } from "./common.js";

const clean = () => window.dispatchEvent(new Event("app:clean"));
const left = (a, cat) => (a.lines || []).filter(l => l.category === cat && remainingQty(l) > 0);

/* ---------------- For Issuance ---------------- */
export function queue(main, [airId]) {
  if (airId) return issuePanel(main, airId);
  const rows = fundAirs().filter(a => a.status === "approved");
  main.innerHTML = `<div class="page-head"><div><h1>For Issuance</h1><p>Approved AIRs in the ${esc(fundName(S.fund))} with items not yet covered by a PAR, ICS or RIS.</p></div></div><div class="card" id="t"></div>`;
  renderTable($("#t", main), {
    id: "issue", rows, pageSize: 30, defaultSort: 0,
    searchText: a => `${a.airNo} ${a.supplier} ${a.office} ${a.endUserName}`,
    columns: [
      { label: "Approved", render: a => fmtDate(a.approvedAt), sort: a => a.approvedAt?.seconds || 0 },
      { label: "AIR No.", render: a => `<b>${esc(a.airNo)}</b>`, sort: a => a.airNo },
      { label: "Office / End-User", render: a => `${esc(a.office)}<div class="xs muted">${esc(a.endUserName)}</div>` },
      { label: "PAR (PPE)", render: a => count(left(a, "ppe")), cls: "right", headCls: "right" },
      { label: "ICS (Semi-Exp.)", render: a => count(left(a, "sx")), cls: "right", headCls: "right" },
      { label: "RIS (Supplies)", render: a => count(left(a, "cons")), cls: "right", headCls: "right" }
    ],
    empty: "Nothing waiting for issuance.",
    onRow: a => { location.hash = `#/issue/${a.id}`; }
  });
}
queue.deps = ["r:airs", "fund"];
const count = ls => ls.length ? `<b>${ls.length}</b> item${ls.length === 1 ? "" : "s"}` : `<span class="muted">—</span>`;

function issuePanel(main, airId) {
  const a = airById(airId);
  if (!a) { main.innerHTML = `<div class="notice warn">AIR not found.</div>`; return; }
  if (a.status !== "approved") { main.innerHTML = `<div class="notice info">AIR ${esc(a.airNo)} has nothing left to issue (${esc(a.status)}). <a href="#/airs/${a.id}">Open the AIR</a></div>`; return; }
  const types = ["par", "ics", "ris"].filter(t => left(a, DOC_TYPES[t].category).length);
  const st = issuePanel.state && issuePanel.state.airId === airId && types.includes(issuePanel.state.type) ? issuePanel.state : { airId, type: types[0] };
  issuePanel.state = st;
  const s = settings(), th = s.thresholds;
  main.innerHTML = `<div class="page-head"><div><h1>Issue from AIR ${esc(a.airNo)}</h1><p>${esc(a.office)} · ${esc(a.supplier)} · encoded by ${esc(a.endUserName)}</p></div><a class="btn" href="#/airs/${a.id}">Open AIR</a></div>
    <div class="tabs">${types.map(t => `<button data-t="${t}" class="${t === st.type ? "active" : ""}">${DOC_TYPES[t].short} — ${esc(CATEGORIES[DOC_TYPES[t].category].short)} (${left(a, DOC_TYPES[t].category).length})</button>`).join("")}</div>
    <form class="card" id="isf" novalidate></form>`;
  $$(".tabs [data-t]", main).forEach(b => b.onclick = () => { st.type = b.dataset.t; issuePanel(main, airId); });
  const t = st.type, cat = DOC_TYPES[t].category, prop = t !== "ris";
  const lines = left(a, cat);
  // Property No. / Inventory Item No. suggested in the year-group-sub major-GL-series format, after every number used that year
  const year = String(a.acceptance?.dateReceived || a.date || manilaToday()).slice(0, 4);
  const suggested = prop ? suggestPropertyNos(lines, year, S.d.assets.map(x => x.propertyNo)) : [];
  const f = $("#isf", main);
  f.innerHTML = `<h3>${esc(DOC_TYPES[t].label)}</h3>
    <p class="xs muted" style="margin-top:-.3rem">${t === "par" ? "Issue PPE to the accountable End-User. A PAR can hold several items; issue to different people by issuing partial quantities." :
      t === "ics" ? `Semi-Expendable items are numbered SPLV (unit cost ₱${num(th.sxHighValue)} and below) or SPHV (above). Mixed items are split into one ICS per class automatically.` :
      "Supplies issued for consumption by an office, or for distribution (accounts 10402xxx). Partial quantities stay in the Stock Card for a later RIS."}</p>
    <div class="table-wrap"><table class="lines"><thead><tr><th></th><th>Item</th><th class="right">Unit cost</th><th class="right">Left</th><th class="right">Issue qty</th>
      ${prop ? `<th>${t === "par" ? "Property No." : "Inventory Item No."}</th><th>${t === "par" ? "Useful life (years)" : "Est. useful life"}</th>` : `<th class="right">Requested</th>`}</tr></thead>
      <tbody>${lines.map(l => `<tr data-id="${esc(l.id)}"><td><input type="checkbox" data-pick checked></td>
        <td><b>${esc(l.description)}</b><div class="xs muted">${esc(l.unit)} · ${esc(l.accountCode)} ${esc(accountName(l.accountCode))}${l.stockNo ? ` · Stock No. ${esc(l.stockNo)}` : ""}${t === "ris" ? ` · ${isDistributionAccount(l.accountCode) ? "Distribution" : "Consumption"}` : ""}${t === "ics" ? ` · ${sxClass(l.unitCost, th) === "low" ? "SPLV" : "SPHV"}` : ""}</div></td>
        <td class="right">${num(l.unitCost)}</td><td class="right">${qty(remainingQty(l))}</td>
        <td><input type="number" class="w-xs" data-q min="0" max="${remainingQty(l)}" step="${prop ? 1 : "any"}" value="${remainingQty(l)}"></td>
        ${prop ? `<td><input class="w-md" data-pn value="${esc(l.propertyNo || suggested[lines.indexOf(l)] || "")}" placeholder="${esc(propertyNoPrefix(l.accountCode, year))}-0001"></td><td>${t === "par" ? `<input type="number" min="0" step="1" class="w-xs" data-ul value="${esc(Number(String(l.usefulLife || "").replace(/[^\d.]/g, "")) || defaultLife(l.accountCode) || "")}">` : `<input class="w-sm" data-ul value="${esc(l.usefulLife || "")}" placeholder="e.g. 3 years">`}</td>` : `<td><input type="number" class="w-xs" data-rq min="0" step="any" value="${remainingQty(l)}"></td>`}</tr>`).join("")}</tbody></table></div>
    <div class="grid g3" style="margin-top:1rem">
      <div><label class="req">Date issued</label><input type="date" name="date" value="${manilaToday()}"></div>
      ${numberingFor(S.settings, t).mode === "manual" ? (t === "ics"
        ? `<div><label>ICS No. — low value (SPLV)</label><input name="no_low" placeholder="if any SPLV item"></div><div><label>ICS No. — high value (SPHV)</label><input name="no_high" placeholder="if any SPHV item"></div>`
        : `<div><label class="req">${DOC_TYPES[t].short} No.</label><input name="no_main" placeholder="as on the printed form"></div>`) : ""}
      <div><label class="req">${t === "ris" ? "Requested / received by" : "Received by (End-User)"}</label><input name="rname" list="ulist" autocomplete="off" value="${esc(a.endUserName || "")}"></div>
      <datalist id="ulist">${activeUsers().map(u => `<option value="${esc(u.displayName)}">${esc(u.office)}</option>`).join("")}</datalist>
      <div><label>Position / designation</label><input name="rpos" value="${esc(activeUsers().find(u => u.id === a.endUserUid)?.position || "")}"></div>
      <div><label>Office</label>${officeSelect("roffice", a.office || "", s.offices)}</div>
      ${t === "ris" ? `<div><label>Responsibility Center Code</label><input name="rcc"></div><div class="span1"><label>Purpose</label><input name="purpose" value="${esc(a.purpose || "")}"></div>
        <div><label>Approved by</label><input name="aname" value="${esc(s.signatories.approver)}"></div><div><label>Designation</label><input name="apos" value="${esc(s.signatories.approverPosition)}"></div><div></div>` : "<div></div>"}
      <div><label>Issued by</label><input name="iname" value="${esc(s.signatories.propertyCustodian || S.account?.displayName || "")}"></div>
      <div><label>Designation</label><input name="ipos" value="${esc(s.signatories.propertyCustodianPosition)}"></div>
    </div>
    <div class="form-msg err" id="msg"></div>
    <div class="modal-actions"><span class="small muted" id="sum"></span><button class="btn primary" type="submit">Issue ${DOC_TYPES[t].short}</button></div>`;
  f.rname.addEventListener("change", () => { const u = activeUsers().find(x => x.displayName === f.rname.value); if (u) { f.rpos.value = u.position || ""; f.roffice.value = u.office || f.roffice.value; } });
  const sum = () => { let tot = 0; $$("tbody tr", f).forEach(tr => { if ($("[data-pick]", tr).checked) { const l = lines.find(x => x.id === tr.dataset.id); tot += (Number($("[data-q]", tr).value) || 0) * l.unitCost; } }); $("#sum", f).textContent = `Total ${money(tot)}`; };
  f.addEventListener("input", sum); sum();
  f.onsubmit = e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f).entries());
    const picks = [], lineInfo = {};
    $$("tbody tr", f).forEach(tr => {
      if (!$("[data-pick]", tr).checked) return;
      picks.push({ lineId: tr.dataset.id, qty: Number($("[data-q]", tr).value) || 0 });
      lineInfo[tr.dataset.id] = prop ? { propertyNo: $("[data-pn]", tr).value, usefulLife: $("[data-ul]", tr).value } : { qtyRequested: Number($("[data-rq]", tr).value) || 0 };
    });
    if (prop) {
      const nos = Object.values(lineInfo).map(x => String(x.propertyNo || "").trim()).filter(Boolean);
      const dup = nos.find((n, i) => nos.indexOf(n) !== i) || nos.find(n => S.d.assets.some(x => x.propertyNo === n && x.status !== "cancelled"));
      if (dup) return toast(`${t === "par" ? "Property" : "Inventory Item"} No. ${dup} is already used. Each item needs its own number.`, "err");
    }
    const header = {
      date: fd.date, purpose: fd.purpose || "", lineInfo, numbers: { main: fd.no_main, low: fd.no_low, high: fd.no_high },
      // property shows as "You" in Office Property of the registered user who receives it (none if not a system user)
      recipient: { uid: activeUsers().find(u => u.displayName === fd.rname.trim())?.id || (fd.rname.trim() === a.endUserName ? a.endUserUid : ""), name: fd.rname.trim(), position: fd.rpos.trim(), office: fd.roffice.trim(), rcc: (fd.rcc || "").trim() },
      issuedBy: { name: fd.iname.trim(), position: fd.ipos.trim() },
      approvedBy: t === "ris" ? { name: (fd.aname || "").trim(), position: (fd.apos || "").trim() } : {}
    };
    $("#msg", f).textContent = "";
    busy(e.submitter || $("[type=submit]", f), async () => {
      try {
        const out = await issueDocs(a.id, t, picks, header);
        clean();
        toast(`${DOC_TYPES[t].short} ${out.map(x => x.number).join(", ")} issued.`, "ok");
        location.hash = `#/issuances/${out[0].id}`;
      } catch (err) { $("#msg", f).textContent = err.message; throw err; }
    }).catch(() => {});
  };
}

/* ---------------- list and detail ---------------- */
export function list(main) {
  const enduser = role() === "enduser";
  const rows = enduser ? S.d.docs : fundDocs();
  main.innerHTML = `<div class="page-head"><div><h1>${enduser ? "PAR / ICS / RIS for My Office" : "PAR / ICS / RIS"}</h1>
      <p>${enduser ? "Property and supplies issued from your AIRs or to your office. Property on a PAR or ICS stays under its receiver's accountability until returned or transferred." : `Documents issued by the GSO in the ${esc(fundName(S.fund))}, and whether Accounting has posted them.`}</p></div>
      <button class="btn" id="csv">Download CSV</button></div><div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "docs-" + role(), rows, pageSize: 30, defaultSort: 1, defaultDir: -1,
    searchText: d => `${d.number} ${d.airNo} ${d.recipient?.name} ${d.recipient?.office} ${(d.lines || []).map(l => `${l.description} ${l.propertyNo} ${l.stockNo}`).join(" ")}`,
    searchPlaceholder: "Number, AIR, recipient, item, property no.",
    filters: [
      { key: "t", label: "Document", options: Object.entries(DOC_TYPES).map(([k, v]) => [k, v.short]), test: (d, v) => d.docType === v },
      { key: "s", label: "Status", options: [["unposted", "For posting"], ["posted", "Posted"], ["cancelled", "Cancelled"]], test: (d, v) => v === "cancelled" ? d.status === "cancelled" : d.status !== "cancelled" && !!d.posting?.posted === (v === "posted") },
      ...(enduser ? [{ key: "f", label: "Fund", options: FUNDS.map(f => [f.code, f.name]), test: (d, v) => d.fund === v }] : [])
    ],
    columns: [
      { label: "Number", render: d => `<b>${esc(d.docType.toUpperCase())} ${esc(d.number)}</b>`, sort: d => d.docType + d.number },
      { label: "Date", render: d => fmtDate(d.date), sort: d => d.date },
      { label: "AIR No.", render: d => d.airId ? `<a href="#/airs/${esc(d.airId)}" onclick="event.stopPropagation()">${esc(d.airNo)}</a>` : `<span class="muted">${d.origin === "pms" ? "From PMS" : "Register items"}</span>`, sort: d => d.airNo },
      { label: "Received by", render: d => `${esc(d.recipient?.name)}<div class="xs muted">${esc(d.recipient?.office)}</div>`, sort: d => d.recipient?.name || "" },
      { label: "Items", render: d => d.lines.length, cls: "right" },
      { label: "Amount", render: d => money(d.total), sort: d => d.total, cls: "right", headCls: "right" },
      { label: "Status", render: d => `${docStatusBadge(d)}${attachmentsOf([{ type: "issuance", id: d.id }]).length ? ` <span class="badge b-ok" title="Signed copy / attachments on file">Attached</span>` : ""}`, sort: d => d.status + !!d.posting?.posted }
    ],
    empty: enduser ? "Nothing has been issued from your AIRs yet." : "No documents issued in this fund yet.",
    onRow: d => { location.hash = `#/issuances/${d.id}`; }
  });
  $("#csv", main).onclick = () => downloadCSV(`PAR-ICS-RIS-${S.fund}`, ["Fund", "Type", "Number", "Date", "AIR No.", "Recipient", "Office", "Item", "Property/Stock No.", "Unit", "Qty", "Unit Cost", "Amount", "Account", "Status", "Posted Ref", "Posted Date"],
    t.rows().flatMap(d => d.lines.map(l => [d.fund, d.docType.toUpperCase(), d.number, d.date, d.airNo, d.recipient?.name, d.recipient?.office, l.description, l.propertyNo || l.stockNo, l.unit, l.qty, l.unitCost, l.amount, l.accountCode, d.status === "cancelled" ? "Cancelled" : d.posting?.posted ? "Posted" : "For posting", d.posting?.ref || "", d.posting?.date || ""])));
}
list.deps = ["r:docs", "r:attachments", "fund"];

export function detail(main, [id]) {
  const d = docById(id);
  if (!d) { main.innerHTML = `<div class="notice warn">Document not found, or you don't have access to it.</div>`; return; }
  const t = DOC_TYPES[d.docType];
  main.innerHTML = `<div class="page-head"><div><h1>${esc(t.short)} ${esc(d.number)}</h1><p>${esc(t.label)} · ${esc(fundName(d.fund))} · ${d.airId ? `from <a href="#/airs/${d.airId}">AIR ${esc(d.airNo)}</a>` : d.origin === "pms" ? "brought over from PMS, where it was still pending (no AIR)" : "for items already in the register"}</p></div>
      <div class="btn-row">${docStatusBadge(d)}</div></div>
    ${d.status === "cancelled" ? `<div class="notice bad"><b>Cancelled</b> ${fmtDateTime(d.cancel?.at)} by ${esc(d.cancel?.by?.name)} — ${esc(d.cancel?.reason)}</div>` : ""}
    <div class="split"><div>
      <div class="card"><div class="card-head"><h3>Items</h3><span class="small muted">Total ${money(d.total)}</span></div>
        <div class="table-wrap"><table><thead><tr><th>Description</th><th>${d.docType === "ris" ? "Stock No." : d.docType === "par" ? "Property No." : "Item No."}</th><th>Unit</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Amount</th><th>Account</th></tr></thead>
        <tbody>${d.lines.map(l => `<tr><td><b>${esc(l.description)}</b>${l.specs ? `<div class="xs muted">${esc(l.specs)}</div>` : ""}${l.usefulLife ? `<div class="xs muted">Useful life: ${esc(l.usefulLife)}</div>` : ""}</td>
          <td>${esc(d.docType === "ris" ? l.stockNo : l.propertyNo) || "—"}</td><td>${esc(l.unit)}</td><td class="right">${qty(l.qty)}</td><td class="right">${num(l.unitCost)}</td><td class="right">${num(l.amount)}</td>
          <td class="small">${esc(l.accountCode)}<div class="xs muted">${esc(accountName(l.accountCode))}</div></td></tr>`).join("")}</tbody></table></div></div>
    </div><div>
      <div class="card"><h3>Details</h3><dl class="kv">
        <dt>Date issued</dt><dd>${fmtDate(d.date)}</dd>
        <dt>${d.docType === "ris" ? "Requested by" : "Received by"}</dt><dd>${esc(d.recipient?.name)}${d.recipient?.position ? `<div class="xs muted">${esc(d.recipient.position)}</div>` : ""}</dd>
        <dt>Office</dt><dd>${esc(d.recipient?.office)}</dd>
        <dt>Issued by</dt><dd>${esc(d.issuedBy?.name || "—")}</dd>
        ${d.purpose ? `<dt>Purpose</dt><dd>${esc(d.purpose)}</dd>` : ""}
        ${d.docType === "ics" ? `<dt>Class</dt><dd>${d.sxClass === "low" ? "Low-Value (SPLV)" : "High-Value (SPHV)"}</dd>` : ""}
        <dt>Encoded</dt><dd>${fmtDateTime(d.createdAt)} · ${esc(d.createdBy?.name)}</dd>
      </dl></div>
      <div class="card"><h3>Accounting</h3>
        ${d.status === "cancelled" ? `<p class="muted">Cancelled documents are not posted.</p>` : d.posting?.posted
          ? `<dl class="kv"><dt>Status</dt><dd><span class="badge b-ok">Posted in the registry</span></dd><dt>Registry</dt><dd>${esc(t.registry)}</dd><dt>JEV / Ref.</dt><dd>${esc(d.posting.ref)}</dd><dt>Posting date</dt><dd>${fmtDate(d.posting.date)}</dd><dt>Posted by</dt><dd>${esc(d.posting.by?.name)}</dd>${d.posting.remarks ? `<dt>Remarks</dt><dd>${esc(d.posting.remarks)}</dd>` : ""}</dl>`
          : `<p class="muted">Not yet posted by Accounting to the ${esc(t.registry)}.</p>`}
        ${can("post") && d.status !== "cancelled" ? `<a class="btn sm" href="#/posting">Open posting</a>` : ""}</div>
      <div class="btn-row"><button class="btn primary" id="print">Print ${esc(t.short)}</button>
        ${canRenumber(d) ? `<button class="btn" id="renum">Change number</button>` : ""}
        ${can("issue") && d.status !== "cancelled" && !d.posting?.posted ? `<button class="btn danger" id="cancel">Cancel ${esc(t.short)}</button>` : ""}</div>
      <div id="att" style="margin-top:1rem"></div>
    </div></div>`;
  attachmentsCard($("#att", main), { type: "issuance", id: d.id, office: d.recipient?.office || d.office || "", fund: d.fund, label: `${t.short} ${d.number}` },
    { defaultLabel: `Signed ${t.short}`, title: `Signed ${t.short} and other attachments` });
  $("#print", main).onclick = () => printForm(docHtml(d));
  $("#renum", main) && ($("#renum", main).onclick = e => renumberDialog("doc", d, t.short, d.number, e.target));
  $("#cancel", main) && ($("#cancel", main).onclick = async e => {
    const v = await confirmBox({ title: `Cancel ${t.short} ${d.number}?`, body: `${d.airId ? "The quantities return to the AIR so they can be issued again." : d.origin === "pms" ? "Its item is cancelled too (it was never posted in the registry)." : "The items stay in the register, without this document."} The number stays used and the document is kept as Cancelled.`, fields: [{ name: "reason", label: "Reason", type: "textarea", required: true }], confirmText: `Cancel ${t.short}`, danger: true });
    if (v) busy(e.target, () => cancelDoc(d.id, v.reason), `${t.short} ${d.number} cancelled.`).catch(() => {});
  });
}
detail.deps = ["r:docs", "r:attachments"];

