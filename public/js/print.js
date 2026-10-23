// Printable official forms. Layouts follow the ones already used in PMS (PAR, ICS, PTR, ITR) and IMS
// (AIR, RIS, Stock Card, Supplies Ledger Card, RSMI). No appendix / annex numbers are printed.
import { $, esc, fmtDate, num, qty, toast } from "./ui.js";
import { settings } from "./state.js";
import { fundName, accountName } from "./core/catalog.js";
import { specialGroup, COMPONENTS, propertyCardRows } from "./core/cards.js";

/** Every printed form and report is A4: portrait, landscape (cards, wide reports) or the A4 sheet of ID tags. */
export function printForm(html, orientation = "portrait") {
  const area = $("#print-area");
  area.dataset.orient = orientation;
  area.innerHTML = `<style>@page { size: ${orientation === "tags" ? "A4 portrait" : `A4 ${orientation}`}; margin: 10mm; }</style>${html}`;
  // Chrome and Edge follow the page size above; Safari and Firefox may not, so remind the user.
  if (!window.chrome) toast(`In the print dialog, set the paper size to A4${orientation === "landscape" ? " and the layout to Landscape" : ""}.`);
  const qrs = area.querySelectorAll("[data-qr]");
  if (!qrs.length) return void setTimeout(() => window.print(), 200);
  loadQR().then(() => {
    qrs.forEach(el => new window.QRCode(el, { text: el.dataset.qr, width: 96, height: 96, correctLevel: window.QRCode.CorrectLevel.M }));
    setTimeout(() => window.print(), 300);
  }).catch(() => { qrs.forEach(el => { el.textContent = "QR unavailable offline"; }); setTimeout(() => window.print(), 200); });
}
let qrLib;
function loadQR() {
  if (window.QRCode) return Promise.resolve();
  return qrLib ||= new Promise((ok, fail) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    sc.onload = ok; sc.onerror = () => { qrLib = null; fail(new Error("QR library didn't load")); };
    document.head.appendChild(sc);
  });
}

function head(title) {
  const s = settings();
  return `<div class="ph"><img src="assets/municipal-seal.png" alt="">
      <div class="l2">Republic of the Philippines</div>
      <div class="l1">${esc(s.entityName.toUpperCase())}</div>
      <div class="l2">${esc(s.address)}</div>
      <div class="l3">${esc(title)}</div></div>`;
}
const blanks = (n, cols) => Array.from({ length: Math.max(0, n) }, () => `<tr class="blank">${"<td></td>".repeat(cols)}</tr>`).join("");
const sig = (who, name, cap, pos, poscap = "Position/Office") => `<div class="col"><div class="who">${esc(who)}</div>
  <div class="name">${esc(name) || "&nbsp;"}</div><div class="cap">${esc(cap)}</div>
  <div class="pos">${esc(pos) || "&nbsp;"}</div><div class="cap">${esc(poscap)}</div><div class="pos">&nbsp;</div><div class="cap">Date</div></div>`;
const box = on => `<span class="pf-box">${on ? "&#10003;" : "&nbsp;"}</span>`;

export function airHtml(a) {
  const s = settings();
  const rows = (a.lines || []).map(l => `<tr><td>${esc(l.stockNo || l.propertyNo || "")}</td>
    <td>${esc(l.description)}${l.specs ? `<div class="pf-spec">${esc(l.specs).replace(/\n/g, "<br>")}</div>` : ""}</td>
    <td class="c">${esc(l.unit)}</td><td class="r">${qty(l.qty)}</td><td class="r">${num(l.unitCost)}</td><td class="r">${num(l.amount)}</td></tr>`).join("");
  return `<div class="pf">${head("ACCEPTANCE AND INSPECTION REPORT")}
    <table class="pmeta-t"><tr><td>Entity Name: <b>${esc(s.entityName)}</b></td><td>Fund Cluster: <b>${esc(fundName(a.fund))}</b></td></tr>
      <tr><td>Supplier: <b>${esc(a.supplier)}</b></td><td>AIR No.: <b>${esc(a.airNo || "")}</b></td></tr>
      <tr><td>PO No./Date: <b>${esc(a.poNo)}${a.poDate ? " / " + fmtDate(a.poDate) : ""}</b></td><td>Date: <b>${fmtDate(a.date)}</b></td></tr>
      <tr><td>Requisitioning Office/Dept.: <b>${esc(a.office)}</b></td><td>Invoice No./Date: <b>${esc(a.invNo)}${a.invDate ? " / " + fmtDate(a.invDate) : ""}</b></td></tr></table>
    <table class="pt"><thead><tr><th style="width:15%">Stock/Property No.</th><th>Description</th><th style="width:9%">Unit</th><th style="width:9%">Quantity</th><th style="width:12%">Unit Cost</th><th style="width:13%">Amount</th></tr></thead>
      <tbody>${rows}<tr class="nothing"><td colspan="6">*** NOTHING FOLLOWS ***</td></tr>${blanks(14 - (a.lines || []).length, 6)}
      <tr><td colspan="5" class="r"><b>TOTAL</b></td><td class="r"><b>${num(a.total)}</b></td></tr></tbody></table>
    <table class="pt"><tr><th style="width:50%"><i>INSPECTION</i></th><th><i>ACCEPTANCE</i></th></tr>
      <tr><td class="pf-cell">Date Inspected: <b>${a.inspection?.dateInspected ? fmtDate(a.inspection.dateInspected) : ""}</b>
          <div style="margin-top:8px">${box(a.inspection?.inspectedOk)} Inspected, verified and found in order as to quantity and specifications</div>
          <div class="pf-signame">${esc(a.inspection?.inspectorName || "")}</div><div class="cap c">Inspection Officer/Inspection Committee</div></td>
        <td class="pf-cell">Date Received: <b>${a.acceptance?.dateReceived ? fmtDate(a.acceptance.dateReceived) : ""}</b>
          <div style="margin-top:8px">${box(a.acceptance?.status === "complete")} Complete</div>
          <div>${box(a.acceptance?.status === "partial")} Partial (pls. specify) <i>${esc(a.acceptance?.partialNote || "")}</i></div>
          <div class="pf-signame">${esc(a.acceptance?.custodianName || "")}</div><div class="cap c">Supply and/or Property Custodian</div></td></tr></table>
    <div class="pf-foot">Encoded by ${esc(a.endUserName || "")} (End-User)</div></div>`;
}

export function parHtml(d) {
  const rows = d.lines.map(l => `<tr><td class="r">${qty(l.qty)}</td><td>${esc(l.unit)}</td>
    <td>${esc(l.description)}${l.specs ? `<div class="pf-spec">${esc(l.specs).replace(/\n/g, "<br>")}</div>` : ""}</td>
    <td class="c">${esc(l.propertyNo)}</td><td class="c">${fmtDate(d.date)}</td><td class="r">${num(l.amount)}</td></tr>`).join("");
  return `<div class="pf">${head("PROPERTY ACKNOWLEDGMENT RECEIPT")}
    <table class="pmeta-t"><tr><td>Dept/Office: <b>${esc(d.recipient?.office || d.office)}</b></td><td></td></tr>
      <tr><td>Fund: <b>${esc(fundName(d.fund))}</b></td><td class="r">PAR No.: <b class="pf-num">${esc(d.number)}</b></td></tr></table>
    <table class="pt"><thead><tr><th style="width:9%">Quantity</th><th style="width:8%">Unit</th><th>Description</th><th style="width:16%">Property Number</th><th style="width:13%">Date Acquired</th><th style="width:14%">Amount</th></tr></thead>
      <tbody>${rows}<tr class="nothing"><td colspan="6">*** NOTHING FOLLOWS ***</td></tr>${blanks(16 - d.lines.length, 6)}
      <tr><td colspan="5" class="r"><b>TOTAL</b></td><td class="r"><b>${num(d.total)}</b></td></tr></tbody></table>
    <div class="pf-ref">Reference: ${d.airId ? `AIR No. ${esc(d.airNo)} · Supplier: ${esc(d.supplier || "")}` : "Property already in the register"}</div>
    <div class="sig2">${sig("Received by:", d.recipient?.name, "Signature over Printed Name of End User", d.recipient?.position)}
      ${sig("Issued by:", d.issuedBy?.name, "Signature over Printed Name of Supply and/or Property Custodian", d.issuedBy?.position)}</div></div>`;
}

export function icsHtml(d) {
  const s = settings();
  const rows = d.lines.map(l => `<tr><td class="r">${qty(l.qty)}</td><td>${esc(l.unit)}</td><td class="r">${num(l.unitCost)}</td><td class="r">${num(l.amount)}</td>
    <td>${esc(l.description)}${l.specs ? `<div class="pf-spec">${esc(l.specs).replace(/\n/g, "<br>")}</div>` : ""}</td>
    <td class="c">${esc(l.propertyNo)}</td><td class="c">${esc(l.usefulLife)}</td></tr>`).join("");
  return `<div class="pf">${head("INVENTORY CUSTODIAN SLIP")}
    <table class="pmeta-t"><tr><td>Entity Name: <b>${esc(s.entityName)} — ${esc(d.recipient?.office || d.office)}</b></td><td></td></tr>
      <tr><td>Fund Cluster: <b>${esc(fundName(d.fund))}</b></td><td class="r">ICS No.: <b class="pf-num">${esc(d.number)}</b></td></tr></table>
    <table class="pt"><thead><tr><th rowspan="2" style="width:8%">Quantity</th><th rowspan="2" style="width:7%">Unit</th><th colspan="2">Amount</th>
      <th rowspan="2">Description</th><th rowspan="2" style="width:13%">Inventory Item No.</th><th rowspan="2" style="width:11%">Estimated Useful Life</th></tr>
      <tr><th style="width:10%">Unit Cost</th><th style="width:11%">Total Cost</th></tr></thead>
      <tbody>${rows}<tr class="nothing"><td colspan="7">*** NOTHING FOLLOWS ***</td></tr>${blanks(16 - d.lines.length, 7)}
      <tr><td colspan="3" class="r"><b>TOTAL</b></td><td class="r"><b>${num(d.total)}</b></td><td colspan="3"></td></tr></tbody></table>
    <div class="pf-ref">Reference: ${d.airId ? `AIR No. ${esc(d.airNo)}` : "Property already in the register"} · ${d.sxClass === "low" ? "Low-Value" : "High-Value"} Semi-Expendable Property</div>
    <div class="sig2">${sig("Received from:", d.issuedBy?.name, "Signature over Printed Name", d.issuedBy?.position)}
      ${sig("Received by:", d.recipient?.name, "Signature over Printed Name", d.recipient?.position)}</div></div>`;
}

export function risHtml(d) {
  const rows = d.lines.map(l => `<tr><td>${esc(l.stockNo)}</td><td>${esc(l.unit)}</td><td>${esc(l.description)}</td><td class="r">${qty(l.qtyRequested || l.qty)}</td>
    <td class="c">${box(true)}</td><td class="c">${box(false)}</td><td class="r">${qty(l.qty)}</td><td>AIR ${esc(d.airNo)}</td></tr>`).join("");
  const sg = d.approvedBy || {};
  return `<div class="pf">${head("REQUISITION AND ISSUE SLIP")}
    <table class="pmeta-t"><tr><td>Entity Name: <b>${esc(settings().entityName)}</b></td><td>Fund Cluster: <b>${esc(fundName(d.fund))}</b></td></tr>
      <tr><td>Division/Office: <b>${esc(d.recipient?.office || d.office)}</b></td><td>RIS No.: <b class="pf-num">${esc(d.number)}</b></td></tr>
      <tr><td>Responsibility Center Code: <b>${esc(d.recipient?.rcc || "")}</b></td><td>Date: <b>${fmtDate(d.date)}</b></td></tr></table>
    <table class="pt"><thead><tr><th colspan="4">Requisition</th><th colspan="2">Stock Available?</th><th colspan="2">Issue</th></tr>
      <tr><th style="width:11%">Stock No.</th><th style="width:8%">Unit</th><th>Description</th><th style="width:9%">Quantity</th><th style="width:6%">Yes</th><th style="width:6%">No</th><th style="width:9%">Quantity</th><th style="width:15%">Remarks</th></tr></thead>
      <tbody>${rows}<tr class="nothing"><td colspan="8">*** NOTHING FOLLOWS ***</td></tr>${blanks(14 - d.lines.length, 8)}</tbody></table>
    <div class="pf-ref">Purpose: ${esc(d.purpose)}</div>
    <table class="pt sigt"><tr><th></th><th>Requested by:</th><th>Approved by:</th><th>Issued by:</th><th>Received by:</th></tr>
      <tr><td>Signature:</td><td></td><td></td><td></td><td></td></tr>
      <tr><td>Printed Name:</td><td>${esc(d.recipient?.name)}</td><td>${esc(sg.name)}</td><td>${esc(d.issuedBy?.name)}</td><td>${esc(d.recipient?.name)}</td></tr>
      <tr><td>Designation:</td><td>${esc(d.recipient?.position)}</td><td>${esc(sg.position)}</td><td>${esc(d.issuedBy?.position)}</td><td>${esc(d.recipient?.position)}</td></tr>
      <tr><td>Date:</td><td></td><td></td><td></td><td></td></tr></table></div>`;
}

export function docHtml(d) { return d.docType === "par" ? parHtml(d) : d.docType === "ics" ? icsHtml(d) : risHtml(d); }

export function stockCardHtml(c, fund, ledger) {
  const rows = c.moves.map(m => ledger
    ? `<tr><td>${fmtDate(m.date)}</td><td>${esc(m.ref)}</td>
        <td class="r">${m.type === "receipt" ? qty(m.qty) : ""}</td><td class="r">${m.type === "receipt" ? num(m.unitCost) : ""}</td><td class="r">${m.type === "receipt" ? num(m.amount) : ""}</td>
        <td class="r">${m.type === "issue" ? qty(m.qty) : ""}</td><td class="r">${m.type === "issue" ? num(m.unitCost) : ""}</td><td class="r">${m.type === "issue" ? num(m.amount) : ""}</td>
        <td class="r">${qty(m.balQty)}</td><td class="r">${num(m.balValue)}</td></tr>`
    : `<tr><td>${fmtDate(m.date)}</td><td>${esc(m.ref)}</td><td class="r">${m.type === "receipt" ? qty(m.qty) : ""}</td>
        <td class="r">${m.type === "issue" ? qty(m.qty) : ""}</td><td>${m.type === "issue" ? esc(m.office) : ""}</td><td class="r">${qty(m.balQty)}</td></tr>`).join("");
  const headRow = ledger
    ? `<tr><th rowspan="2">Date</th><th rowspan="2">Reference</th><th colspan="3">Receipt</th><th colspan="3">Issue</th><th colspan="2">Balance</th></tr>
       <tr><th>Qty.</th><th>Unit Cost</th><th>Total Cost</th><th>Qty.</th><th>Unit Cost</th><th>Total Cost</th><th>Qty.</th><th>Total Cost</th></tr>`
    : `<tr><th rowspan="2">Date</th><th rowspan="2">Reference</th><th>Receipt</th><th colspan="2">Issue</th><th rowspan="2">Balance Qty.</th></tr><tr><th>Qty.</th><th>Qty.</th><th>Office</th></tr>`;
  return `<div class="pf">${head(ledger ? "SUPPLIES LEDGER CARD" : "STOCK CARD")}
    <table class="pmeta-t"><tr><td>Fund: <b>${esc(fundName(fund))}</b></td><td>Stock No.: <b>${esc(c.stockNo)}</b></td></tr>
      <tr><td>Item/Description: <b>${esc(c.description)}</b></td><td>Unit: <b>${esc(c.unit)}</b></td></tr>
      <tr><td>Account: <b>${esc(c.accountCode)} ${esc(accountName(c.accountCode))}</b></td><td></td></tr></table>
    <table class="pt"><thead>${headRow}</thead><tbody>${rows}</tbody></table>
    <div class="pf-foot">${ledger ? "For Accounting Office use" : "For Property/Supply Office use"}</div></div>`;
}

export function rsmiHtml(r, fund, from, to) {
  const s = settings();
  const rows = r.lines.map(l => `<tr><td>${esc(l.risNo)}</td><td>${esc(l.office)}</td><td>${esc(l.stockNo)}</td><td>${esc(l.description)}</td><td>${esc(l.unit)}</td>
    <td class="r">${qty(l.qty)}</td><td class="r">${num(l.unitCost)}</td><td class="r">${num(l.amount)}</td></tr>`).join("");
  const recap = r.recap.map(c => `<tr><td>${esc(c.stockNo)}</td><td class="r">${qty(c.qty)}</td><td class="r">${num(c.unitCost)}</td><td class="r">${num(c.amount)}</td><td>${esc(c.accountCode)}</td></tr>`).join("");
  return `<div class="pf">${head("REPORT OF SUPPLIES AND MATERIALS ISSUED")}
    <div class="c" style="font-size:11px">For the period ${fmtDate(from)} to ${fmtDate(to)}</div>
    <table class="pmeta-t"><tr><td>Entity Name: <b>${esc(s.entityName)}</b></td><td>Fund Cluster: <b>${esc(fundName(fund))}</b></td></tr></table>
    <table class="pt"><thead><tr><th>RIS No.</th><th>Responsibility Center</th><th>Stock No.</th><th>Item</th><th>Unit</th><th>Quantity Issued</th><th>Unit Cost</th><th>Amount</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="c">No issuances in this period</td></tr>`}<tr><td colspan="7" class="r"><b>TOTAL</b></td><td class="r"><b>${num(r.total)}</b></td></tr></tbody></table>
    <div style="margin-top:8px;font-size:11px"><b>Recapitulation</b></div>
    <table class="pt"><thead><tr><th>Stock No.</th><th>Quantity</th><th>Unit Cost</th><th>Total Cost</th><th>UACS Object Code</th></tr></thead><tbody>${recap}</tbody></table>
    <div class="sig2">${sig("I hereby certify to the correctness of the above information.", s.signatories.propertyCustodian, "Signature over Printed Name of Supply and/or Property Custodian", s.signatories.propertyCustodianPosition, "Designation")}
      ${sig("Posted by:", s.signatories.accountant, "Signature over Printed Name of Designated Accounting Staff", s.signatories.accountantPosition, "Designation")}</div></div>`;
}

/** Simple tabular report (registries, monitoring) with the municipal header. */
export function tableReportHtml(title, subtitle, headers, rows, totals) {
  return `<div class="pf">${head(title)}${subtitle ? `<div class="c" style="font-size:11px;margin-bottom:6px">${esc(subtitle)}</div>` : ""}
    <table class="pt"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}${totals ? `<tr>${totals.map(v => `<td><b>${esc(v)}</b></td>`).join("")}</tr>` : ""}</tbody></table></div>`;
}

/* ---------------- property movements ---------------- */
const TTYPE = [["donation", "Donation"], ["relocate", "Relocate"], ["reassignment", "Reassignment"], ["others", "Others (Specify)"]];
const tick = on => on ? "&#9745;" : "&#9744;";

export function movementHtml(m) {
  if (m.docType === "ptr" || m.docType === "itr") return transferHtml(m);
  if (m.docType === "dsp") return disposalHtml(m);
  return returnHtml(m);
}

function transferHtml(m) {
  const sx = m.docType === "itr";
  const rows = m.lines.map(l => sx
    ? `<tr><td class="c">${fmtDate(l.dateAcquired)}</td><td class="c">${esc(l.propertyNo)}</td><td class="c">${esc(l.parIcsNo)}</td><td>${esc(l.description)}${l.qty > 1 ? ` (${qty(l.qty)} ${esc(l.unit)})` : ""}</td><td class="r">${num(l.amount)}</td><td class="c">${esc(l.condition)}</td></tr>`
    : `<tr><td class="c">${fmtDate(l.dateAcquired)}</td><td class="c">${esc(l.propertyNo)}</td><td>${esc(l.description)}</td><td class="r">${num(l.amount)}</td><td class="c">${esc(l.condition)}</td></tr>`).join("");
  const cols = sx ? 6 : 5;
  return `<div class="pf">${head(sx ? "INVENTORY TRANSFER REPORT" : "PROPERTY TRANSFER REPORT")}
    <table class="pmeta-t"><tr><td>Entity Name: <b>${esc(settings().entityName)}</b></td><td>Fund Cluster: <b>${esc(fundName(m.fund))}</b></td></tr>
      <tr><td>From Accountable Officer/Agency/Fund Cluster: <b>${esc(m.from?.name)}${m.from?.office ? ` — ${esc(m.from.office)}` : ""}</b></td><td>${sx ? "ITR" : "PTR"} No.: <b class="pf-num">${esc(m.number)}</b></td></tr>
      <tr><td>To Accountable Officer/Agency/Fund Cluster: <b>${esc(m.to?.name)}${m.to?.office ? ` — ${esc(m.to.office)}` : ""}</b></td><td>Date: <b>${fmtDate(m.date)}</b></td></tr></table>
    <div style="font-size:11px;margin:6px 0"><b>Transfer Type:</b> (check only one) &nbsp; ${TTYPE.map(([k, l]) => `${tick(m.transferType === k)} ${l}${k === "others" && m.transferType === "others" ? `: ${esc(m.typeOther)}` : ""}`).join(" &nbsp;&nbsp; ")}</div>
    <table class="pt"><thead><tr><th style="width:12%">Date Acquired</th><th style="width:15%">${sx ? "Item No." : "Property No."}</th>${sx ? `<th style="width:14%">ICS No./Date</th>` : ""}<th>Description</th><th style="width:13%">Amount</th><th style="width:14%">Condition of ${sx ? "Inventory" : "PPE"}</th></tr></thead>
      <tbody>${rows}<tr class="nothing"><td colspan="${cols}">*** NOTHING FOLLOWS ***</td></tr>${blanks(12 - m.lines.length, cols)}</tbody></table>
    <div class="pf-ref">Reason for Transfer: ${esc(m.reason)}</div>
    <div class="sig2">${sig("Approved by:", m.approvedBy?.name, "Signature over Printed Name", m.approvedBy?.position)}
      ${sig("Released/Issued by:", m.issuedBy?.name, "Signature over Printed Name", m.issuedBy?.position)}
      ${sig("Received by:", m.to?.name, "Signature over Printed Name", m.to?.position)}</div></div>`;
}

function returnHtml(m) {
  const sx = m.docType === "rrsp";
  const rows = m.lines.map(l => `<tr><td>${esc(l.description)}</td><td class="r">${qty(l.qty)}</td><td class="c">${esc(sx ? l.parIcsNo : l.propertyNo)}</td><td class="c">${esc(sx ? l.propertyNo : l.parIcsNo)}</td><td>${esc(m.from?.name)}</td><td class="r">${num(l.amount)}</td><td class="c">${esc(l.condition)}</td></tr>`).join("");
  return `<div class="pf">${head(sx ? "RECEIPT OF RETURNED SEMI-EXPENDABLE PROPERTY" : "PROPERTY RETURN SLIP")}
    <table class="pmeta-t"><tr><td>Entity Name: <b>${esc(settings().entityName)}</b></td><td>${sx ? "RRSP" : "PRS"} No.: <b class="pf-num">${esc(m.number)}</b></td></tr>
      <tr><td>Fund Cluster: <b>${esc(fundName(m.fund))}</b></td><td>Date: <b>${fmtDate(m.date)}</b></td></tr></table>
    <div style="font-size:11px;margin:6px 0">This is to acknowledge receipt of the returned ${sx ? "Semi-expendable Property" : "Property, Plant and Equipment"}.</div>
    <table class="pt"><thead><tr><th>Item Description</th><th style="width:7%">Quantity</th><th style="width:13%">${sx ? "ICS No." : "Property No."}</th><th style="width:13%">${sx ? "Item No." : "PAR No."}</th><th style="width:16%">End-user</th><th style="width:11%">Amount</th><th style="width:11%">Remarks / Condition</th></tr></thead>
      <tbody>${rows}<tr class="nothing"><td colspan="7">*** NOTHING FOLLOWS ***</td></tr>${blanks(12 - m.lines.length, 7)}</tbody></table>
    <div class="pf-ref">Reason for return: ${esc(m.reason)}</div>
    <div class="sig2">${sig("Returned by:", m.from?.name, "End User", m.from?.position)}
      ${sig("Received by:", m.to?.name, "Head, Property and/or Supply Division/Unit", m.to?.position)}</div></div>`;
}

function disposalHtml(m) {
  const rows = m.lines.map(l => `<tr><td class="c">${fmtDate(l.dateAcquired)}</td><td class="c">${esc(l.propertyNo)}</td><td>${esc(l.description)}</td><td class="r">${qty(l.qty)}</td><td class="r">${num(l.amount)}</td><td class="r">${num(l.amount - l.carrying)}</td><td class="r">${num(l.carrying)}</td><td>${esc(l.accountCode)}</td></tr>`).join("");
  return `<div class="pf">${head("REPORT OF PROPERTY DISPOSED / DERECOGNIZED")}
    <table class="pmeta-t"><tr><td>Entity Name: <b>${esc(settings().entityName)}</b></td><td>No.: <b class="pf-num">${esc(m.number)}</b></td></tr>
      <tr><td>Fund Cluster: <b>${esc(fundName(m.fund))}</b></td><td>Date: <b>${fmtDate(m.date)}</b></td></tr>
      <tr><td>Mode: <b>${esc(m.mode || (m.transferType === "donation" ? "Donated out" : ""))}</b></td><td>Reference (IIRUP / other): <b>${esc(m.ref)}</b></td></tr>
      <tr><td>Last accountable officer: <b>${esc(m.from?.name)}</b></td><td></td></tr></table>
    <table class="pt"><thead><tr><th>Date Acquired</th><th>Property No.</th><th>Description</th><th>Qty</th><th>Cost</th><th>Accumulated Depreciation</th><th>Carrying Amount</th><th>Account</th></tr></thead>
      <tbody>${rows}<tr><td colspan="4" class="r"><b>TOTAL</b></td><td class="r"><b>${num(m.total)}</b></td><td class="r"><b>${num(m.total - m.carryingTotal)}</b></td><td class="r"><b>${num(m.carryingTotal)}</b></td><td></td></tr></tbody></table>
    <div class="pf-ref">Remarks: ${esc(m.reason)}</div>
    <div class="sig2">${sig("Prepared by:", m.issuedBy?.name || settings().signatories.propertyCustodian, "Supply and/or Property Custodian", m.issuedBy?.position || settings().signatories.propertyCustodianPosition)}
      ${sig("Approved by:", m.approvedBy?.name, "Signature over Printed Name", m.approvedBy?.position)}</div></div>`;
}

/* ---------------- Ledger Cards and Property Cards (PMS layouts) ----------------
 * `rows` is assetTimeline(a, ctx) from core/cards.js. PPE prints the Equipment Ledger Card / Property Card,
 * or the special form for Land, Road Network, Other Public Infrastructure, Buildings and Biological Assets;
 * semi-expendable prints the SX Ledger Card / SX Property Card. All landscape. */
const shortDate = d => d ? fmtDate(d) : "";
const cardHead = (title, a, fundLabel = "Fund") => `${head(title)}<div class="r" style="font-size:11px;margin-top:-4px">${fundLabel}: <b><u>${esc(fundName(a.fund))}</u></b></div>`;
const info = cells => `<table class="pt pinfo">${cells.map(r => `<tr>${r.map(([l, v, span]) => `<td class="lbl">${esc(l)}</td><td${span ? ` colspan="${span}"` : ""}>${v}</td>`).join("")}</tr>`).join("")}</table>`;
const blankRows = (n, cols) => blanks(n, cols);
const officerOf = a => a.holder?.name ? ` — ${esc(a.holder.name)}` : "";

function equipmentLedger(a, rows) {
  const dep = a.depreciable !== false;
  return `<div class="pf card-l">${cardHead("EQUIPMENT LEDGER CARD", a)}
    ${info([[["Equipment:", esc(a.articleType || accountName(a.accountCode))], ["Account Code:", esc(a.accountCode)]], [["Description:", `${esc(a.description)}${officerOf(a)}`, 3]]])}
    <table class="pt"><thead><tr><th rowspan="2" style="width:7%">Date</th><th rowspan="2" style="width:10%">Reference</th><th rowspan="2" style="width:18%">Particulars</th><th rowspan="2" style="width:9%">Property ID No.</th>
      <th rowspan="2" style="width:8%">Cost</th><th rowspan="2" style="width:6%">Estimated Useful Life</th><th rowspan="2" style="width:8%">Accumulated Depreciation</th><th rowspan="2" style="width:8%">Accumulated Impairment Losses</th>
      <th rowspan="2" style="width:8%">Adjusted Cost</th><th colspan="2">Repair History</th><th rowspan="2" style="width:7%">Remarks</th></tr><tr><th style="width:6%">Nature of Repair</th><th style="width:5%">Amount</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td>${shortDate(r.date)}</td><td>${esc(r.reference)}</td><td>${i === 0 ? esc(a.description) : esc(r.label)}</td><td>${i === 0 ? esc(a.propertyNo) : ""}</td>
      <td class="r">${i === 0 || r.kind === "revalue" ? num(r.cost) : ""}</td><td class="c">${i === 0 && a.usefulLifeYears ? `${esc(a.usefulLifeYears)} yrs` : ""}</td>
      <td class="r">${dep && r.kind !== "repair" ? num(r.accum) : ""}</td><td class="r">${r.kind === "impairment" ? num(r.impairment) : ""}</td><td class="r">${r.kind === "repair" ? "" : num(r.adjusted)}</td>
      <td>${r.kind === "repair" ? esc(r.repairNature) : ""}</td><td class="r">${r.kind === "repair" ? num(r.repairAmount) : ""}</td><td>${r.kind === "retire" ? "Disposed" : r.kind === "transfer" ? "Transferred" : ""}</td></tr>`).join("")}
    ${blankRows(14 - rows.length, 12)}</tbody></table></div>`;
}

function equipmentProperty(a, rows) {
  const list = propertyCardRows(rows);
  return `<div class="pf card-l">${cardHead("PROPERTY CARD", a)}
    ${info([[["Property, Plant and Equipment:", esc(a.articleType || accountName(a.accountCode))], ["Property Number:", esc(a.propertyNo)]], [["Description:", esc(a.description) + (a.specs ? ` — ${esc(a.specs)}` : ""), 3]]])}
    <table class="pt"><thead><tr><th rowspan="2" style="width:9%">Date</th><th rowspan="2" style="width:14%">Reference/ PAR No.</th><th style="width:8%">Receipt</th><th colspan="2">Issue/Transfer/Disposal</th>
      <th rowspan="2" style="width:8%">Balance Qty.</th><th rowspan="2" style="width:12%">Amount</th><th rowspan="2" style="width:15%">Remarks</th></tr><tr><th>Qty.</th><th style="width:8%">Qty.</th><th style="width:18%">Office/Officer</th></tr></thead>
    <tbody>${list.map(r => { const out = ["transfer", "retire", "return"].includes(r.kind);
      return `<tr><td>${shortDate(r.date)}</td><td>${esc(r.reference)}</td><td class="r">${r.kind === "acquire" || r.kind === "reactivate" ? qty(a.qty || 1) : ""}</td><td class="r">${out ? qty(r.kind === "retire" ? a.qty || 1 : r.qty || a.qty || 1) : ""}</td>
        <td>${r.kind === "transfer" ? esc([r.officer, r.office].filter(Boolean).join(" — ")) : r.kind === "return" ? "Returned to GSO" : r.kind === "retire" ? esc(a.holder?.name || "") : r.kind === "acquire" ? esc([a.parIcs?.recipient || "", a.holder?.office || ""].filter(Boolean).join(" — ")) : ""}</td>
        <td class="r">${qty(r.balanceQty)}</td><td class="r">${num(r.cost)}</td><td>${r.kind === "revalue" ? esc(r.label) : r.kind === "transfer" ? "Transferred" : r.kind === "retire" ? esc(r.label) : r.kind === "reactivate" ? esc(r.label) : ""}</td></tr>`; }).join("")}
    ${blankRows(12 - list.length, 8)}</tbody></table></div>`;
}

function landHeader(a, withAccount) {
  const sp = a.special || {};
  return info([...(withAccount ? [[["Account:", `${esc(a.accountCode)} — ${esc(accountName(a.accountCode))}`, 3]]] : []),
    [["Location:", esc(a.location || "—")], ["Lot ID No.:", esc(sp.lotId || "—")]], [["Description:", esc(a.description), 3]],
    [["Classification:", esc(sp.classification || "—"), 3]], [["Area:", esc(sp.area || "—"), 3]], [["Technical Description:", esc(sp.technicalDesc || "—"), 3]]]);
}
function landLedger(a, rows) {
  return `<div class="pf card-l">${cardHead("LAND AND LAND IMPROVEMENTS LEDGER CARD", a)}${landHeader(a, true)}
    <table class="pt"><thead><tr><th style="width:9%">Date</th><th style="width:11%">Reference</th><th style="width:18%">Particulars</th><th>Amount</th><th>Additions</th><th style="width:12%">Accumulated Depreciation (for Land Improvements)</th><th>Impairment</th><th>Carrying Amount</th><th>Disposal</th></tr></thead>
    <tbody>${rows.filter(r => r.kind !== "repair").map((r, i) => `<tr><td>${shortDate(r.date)}</td><td>${esc(r.reference)}</td><td>${i === 0 ? esc(a.description) : esc(r.label)}</td><td class="r">${i === 0 ? num(r.cost) : ""}</td>
      <td class="r">${r.kind === "revalue" ? num(r.cost) : ""}</td><td class="r">${a.depreciable !== false && Number(a.usefulLifeYears) ? num(r.accum) : ""}</td><td class="r">${r.kind === "impairment" ? num(r.impairment) : ""}</td><td class="r">${num(r.adjusted)}</td><td class="r">${r.kind === "retire" ? num(r.adjusted) : ""}</td></tr>`).join("")}
    ${blankRows(12 - rows.length, 9)}</tbody></table></div>`;
}
function landProperty(a, rows) {
  const list = propertyCardRows(rows);
  return `<div class="pf card-l">${cardHead("LAND AND LAND IMPROVEMENTS PROPERTY CARD", a)}${landHeader(a, false)}
    <table class="pt"><thead><tr><th style="width:10%">Date</th><th style="width:12%">Reference</th><th style="width:20%">Particulars</th><th>Amount</th><th>Additions</th><th>Adjustments</th><th>Disposal</th><th>Carrying Amount</th></tr></thead>
    <tbody>${list.map((r, i) => `<tr><td>${shortDate(r.date)}</td><td>${esc(r.reference)}</td><td>${i === 0 ? esc(a.description) : esc(r.label)}</td><td class="r">${i === 0 ? num(r.cost) : ""}</td><td class="r">${r.kind === "revalue" ? num(r.cost) : ""}</td><td></td>
      <td class="r">${r.kind === "retire" ? num(r.cost) : ""}</td><td class="r">${r.kind === "retire" ? "0.00" : num(r.cost)}</td></tr>`).join("")}
    ${blankRows(12 - list.length, 8)}</tbody></table></div>`;
}

/** Road, Other Public Infrastructure and Buildings: one section per component. The item's own history prints under the
 *  component that carries the depreciation (Pavement for roads, the first one otherwise); the other components show
 *  their allocated cost when known, else blank rows to fill in by hand. */
function componentCard(a, rows, { title, header, variant, group }) {
  const ledger = variant === "ledger", cols = ledger ? 12 : 9;
  const comps = COMPONENTS[group], amounts = a.components || {}, primary = group === "road" ? 1 : 0;
  // the other components' known amounts print in their own sections, so the primary one shows the rest
  const others = comps.reduce((t, [k], idx) => t + (idx !== primary && Number(amounts[k]) ? Number(amounts[k]) : 0), 0);
  rows = rows.map(r => others ? { ...r, cost: r.cost - others, adjusted: r.adjusted - others } : r);
  const list = ledger ? rows : rows.filter(r => !["depreciation", "baseline", "impairment", "adjustment"].includes(r.kind));
  const row = (r, i) => ledger
    ? `<tr><td></td><td class="c">${i === 0 && a.usefulLifeYears ? `${esc(a.usefulLifeYears)} yrs` : ""}</td><td>${shortDate(r.date)}</td><td>${esc(r.reference)}</td><td>${i === 0 ? esc(a.description) : esc(r.label)}</td>
        <td class="r">${i === 0 || r.kind === "revalue" ? num(r.cost) : ""}</td><td class="r">${r.kind === "repair" ? "" : num(r.accum)}</td><td class="r">${r.kind === "impairment" ? num(r.impairment) : ""}</td><td class="r">${r.kind === "adjustment" ? num(r.adjustment) : ""}</td>
        <td class="r">${r.kind === "repair" ? "" : num(r.adjusted)}</td><td>${r.kind === "repair" ? esc(r.repairNature) : ""}</td><td class="r">${r.kind === "repair" ? num(r.repairAmount) : ""}</td></tr>`
    : `<tr><td></td><td>${shortDate(r.date)}</td><td>${esc(r.reference)}</td><td>${i === 0 ? esc(a.description) : esc(r.label)}</td><td class="r">${i === 0 || r.kind === "revalue" ? num(r.cost) : ""}</td><td></td>
        <td class="r">${r.kind === "repair" ? "" : num(r.cost)}</td><td>${r.kind === "repair" ? esc(r.repairNature) : ""}</td><td class="r">${r.kind === "repair" ? num(r.repairAmount) : ""}</td></tr>`;
  const staticRow = v => ledger
    ? `<tr><td></td><td></td><td>${shortDate(a.dateAcquired)}</td><td></td><td>Included in acquisition cost above</td><td class="r">${num(v)}</td><td></td><td></td><td></td><td class="r">${num(v)}</td><td></td><td></td></tr>`
    : `<tr><td></td><td>${shortDate(a.dateAcquired)}</td><td></td><td>Included in acquisition cost above</td><td class="r">${num(v)}</td><td></td><td class="r">${num(v)}</td><td></td><td></td></tr>`;
  const body = comps.map(([key, label], idx) => {
    const known = amounts[key] != null && amounts[key] !== "" && idx !== primary;
    const data = idx === primary ? list.map(row).join("") : known ? staticRow(Number(amounts[key])) : "";
    const blank = idx === primary ? Math.max(2, 5 - list.length) : known ? 3 : 4;
    return `<tr><td colspan="${cols}" style="font-weight:700;background:#f2f2f2">${esc(label)}</td></tr>${data}${blankRows(blank, cols)}`;
  }).join("");
  const thead = ledger
    ? `<tr><th rowspan="2" style="width:10%">Components</th><th rowspan="2" style="width:6%">Estimated Useful Life</th><th rowspan="2" style="width:7%">Date</th><th rowspan="2" style="width:9%">Reference</th><th rowspan="2" style="width:15%">Description</th><th rowspan="2" style="width:8%">Cost</th>
        <th rowspan="2" style="width:8%">Accumulated Depreciation</th><th rowspan="2" style="width:8%">Accumulated Impairment Loss</th><th rowspan="2" style="width:7%">Adjustment/s</th><th rowspan="2" style="width:8%">Carrying Amount</th><th colspan="2">Maintenance History</th></tr>
       <tr><th style="width:8%">Nature of Maintenance</th><th style="width:6%">Amount</th></tr>`
    : `<tr><th rowspan="2" style="width:13%">Components</th><th rowspan="2" style="width:8%">Date</th><th rowspan="2" style="width:10%">Reference</th><th rowspan="2" style="width:20%">Description</th><th rowspan="2" style="width:9%">Cost</th><th rowspan="2" style="width:9%">Adjustment/s</th><th rowspan="2" style="width:9%">Adjusted Cost</th><th colspan="2">Maintenance History</th></tr>
       <tr><th style="width:9%">Nature of Maintenance</th><th style="width:7%">Amount</th></tr>`;
  return `<div class="pf card-l">${cardHead(title, a)}${header}<table class="pt"><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
}
function specialHeader(a, group) {
  const sp = a.special || {}, v = k => esc(sp[k] || "—");
  if (group === "road") return info([[["Road Network ID No.:", v("roadId")]], [["Name of Road Network:", esc(a.description)]], [["Type of Road:", v("roadType")]], [["Location:", esc(a.location || "—")]], [["Length / Width:", `${v("length")} / ${v("width")}`]], [["Thickness (Pavement):", v("thickness")]]]);
  if (group === "buildings") return info([[["Building/Structure ID No.:", v("bldgId")]], [["Name of Building/Structure:", esc(a.description)]], [["Type/Made of Building:", v("typeMade")]], [["Location:", esc(a.location || "—")]], [["Floor Area / No. of Floors:", `${v("floorArea")} / ${v("floors")}`]]]);
  return info([[["Account:", `${esc(a.accountCode)} — ${esc(accountName(a.accountCode))}`], ["Public Infrastructure ID No.:", v("infraId")]], [["Name:", esc(a.description), 3]], [["Type:", v("infraType"), 3]], [["Location:", esc(a.location || "—"), 3]], [["Other detailed description:", v("otherDesc"), 3]]]);
}
const SPECIAL_TITLES = { road: "LOCAL ROAD NETWORK", otherinfra: "OTHER PUBLIC INFRASTRUCTURE", buildings: "BUILDINGS AND STRUCTURES" };

function biologicalProperty(a, rows) {
  const n = Number(a.special?.headCount) || Number(a.qty) || 1, reason = String(a.disposal?.reason || a.disposal?.mode || "").toLowerCase();
  let bal = 0;
  const list = rows.filter(r => ["acquire", "revalue", "retire", "reactivate", "transfer"].includes(r.kind));
  const body = list.map(r => {
    const c = Array(8).fill(""); let remarks = "";
    if (r.kind === "acquire" || r.kind === "reactivate") { c[0] = n; bal = n; }
    if (r.kind === "retire") { if (reason.includes("sale")) c[3] = bal; else if (reason.includes("transfer")) c[5] = bal; else if (reason.includes("death") || reason.includes("died")) c[6] = bal; else { c[7] = bal; remarks = r.label; } bal = 0; }
    if (r.kind === "transfer") remarks = r.label;
    return `<tr><td>${shortDate(r.date)}</td><td>${esc(r.reference)}</td>${c.map(x => `<td class="r">${x}</td>`).join("")}<td class="r">${r.kind === "acquire" || r.kind === "revalue" ? num(r.cost) : ""}</td><td class="r">${bal}</td><td class="r">${bal ? num(r.cost) : "0.00"}</td><td>${esc(remarks)}</td></tr>`;
  }).join("");
  return `<div class="pf card-l">${cardHead("BIOLOGICAL ASSETS PROPERTY CARD", a)}
    ${info([[["Biological Asset:", esc(accountName(a.accountCode))]], [["Description:", esc(a.description)]]])}
    <table class="pt"><thead><tr><th rowspan="2" style="width:8%">Date</th><th rowspan="2" style="width:10%">Reference</th><th colspan="3">Additions</th><th colspan="5">Reductions</th><th rowspan="2" style="width:8%">Fair Value</th><th colspan="2">Balance</th><th rowspan="2" style="width:10%">Remarks</th></tr>
      <tr><th>Purchase Qty.</th><th>Birth Qty.</th><th>Others Qty.</th><th>Sale Qty.</th><th>Selling Price</th><th>Transfer Qty.</th><th>Death Qty.</th><th>Others Qty.</th><th>Qty.</th><th>Amount</th></tr></thead>
    <tbody>${body}${blankRows(12 - list.length, 14)}</tbody></table></div>`;
}

function sxLedger(a, rows) {
  const list = rows.filter(r => !["depreciation", "baseline"].includes(r.kind));
  return `<div class="pf card-l">${cardHead("SEMI-EXPENDABLE PROPERTY LEDGER CARD", a, "Fund Cluster")}
    ${info([[["Entity Name:", esc(settings().entityName), 3]], [["Semi-expendable Property:", esc(a.articleType || accountName(a.accountCode))], ["Semi-expendable Property No.:", esc(a.propertyNo || "—")]],
      [["Description:", `${esc(a.description)}${officerOf(a)}`], ["UACS Object Code:", esc(a.accountCode || "—")]]])}
    <table class="pt"><thead><tr><th rowspan="2" style="width:8%">Date</th><th rowspan="2" style="width:11%">Reference</th><th colspan="3">Receipt</th><th rowspan="2" style="width:11%">Issues/Transfers/ Adjustments</th><th rowspan="2" style="width:10%">Accumulated Impairment Losses</th><th rowspan="2" style="width:9%">Adjusted Cost</th><th colspan="2">Repair History</th></tr>
      <tr><th style="width:5%">Qty.</th><th style="width:8%">Unit Cost</th><th style="width:8%">Total Cost</th><th style="width:10%">Nature of Repair</th><th style="width:7%">Amount</th></tr></thead>
    <tbody>${list.map(r => `<tr><td>${shortDate(r.date)}</td><td>${esc(r.reference)}</td><td class="r">${r.kind === "acquire" ? qty(a.qty || 1) : ""}</td><td class="r">${r.kind === "acquire" ? num(a.unitCost || (a.cost / (a.qty || 1))) : ""}</td><td class="r">${r.kind === "acquire" ? num(r.cost) : ""}</td>
      <td class="r">${r.kind === "adjustment" ? num(r.adjustment) : r.kind === "transfer" ? esc(r.officer) : r.kind === "return" ? "Returned" : r.kind === "retire" ? "Disposed" : r.kind === "revalue" ? num(r.cost) : ""}</td><td class="r">${r.kind === "impairment" ? num(r.impairment) : ""}</td>
      <td class="r">${r.kind === "repair" ? "" : num(r.sxAdjusted)}</td><td>${r.kind === "repair" ? esc(r.repairNature) : ""}</td><td class="r">${r.kind === "repair" ? num(r.repairAmount) : ""}</td></tr>`).join("")}
    ${blankRows(12 - list.length, 10)}</tbody></table></div>`;
}
function sxProperty(a, rows) {
  const list = rows.filter(r => ["acquire", "transfer", "return", "retire", "reactivate"].includes(r.kind));
  return `<div class="pf card-l">${cardHead("SEMI-EXPENDABLE PROPERTY CARD", a)}
    ${info([[["Semi-Expendable No.:", esc(a.propertyNo || "—")], ["Article/Type:", esc(a.articleType || accountName(a.accountCode) || "—")]], [["Item Description:", esc(a.description)], ["Accountable Officer:", esc(a.holder?.name || "—")]],
      [["Location/Office:", esc(a.holder?.office || a.location || "—")], ["Unit of Measure:", esc(a.unit || "—")]]])}
    <table class="pt"><thead><tr><th rowspan="2" style="width:9%">Date</th><th rowspan="2" style="width:13%">Reference</th><th rowspan="2" style="width:8%">Receipt Qty.</th><th colspan="3">Issue/Return/Disposal</th><th colspan="2">Balance</th></tr>
      <tr><th style="width:7%">Qty.</th><th style="width:9%">Type</th><th style="width:18%">Remarks</th><th style="width:7%">Qty.</th><th style="width:10%">Value</th></tr></thead>
    <tbody>${list.map(r => `<tr><td>${shortDate(r.date)}</td><td>${esc(r.reference)}</td><td class="r">${r.kind === "acquire" || r.kind === "reactivate" ? qty(a.qty || 1) : ""}</td><td class="r">${["transfer", "return", "retire"].includes(r.kind) ? qty(r.qty || a.qty || 1) : ""}</td>
      <td>${{ transfer: "Transfer", return: "Return", retire: "Disposal", reactivate: "Reactivated" }[r.kind] || ""}</td><td>${r.kind === "acquire" ? "" : esc(r.kind === "transfer" ? [r.officer, r.office].filter(Boolean).join(" — ") : r.label)}</td>
      <td class="r">${qty(r.balanceQty)}</td><td class="r">${r.balanceQty ? num(r.sxAdjusted) : "0.00"}</td></tr>`).join("")}
    ${blankRows(10 - list.length, 8)}</tbody></table>
    ${info([[["Status:", a.status === "disposed" ? "Disposed" : a.status === "returned" ? "Returned to GSO" : "In use"], ["Remarks:", esc(a.remarks || "")]]])}</div>`;
}

/** Ledger Card for one item (the Accounting copy). */
export function ledgerCardHtml(a, rows) {
  if (a.itemType === "sx") return sxLedger(a, rows);
  const g = specialGroup(a.accountCode);
  if (g === "land") return landLedger(a, rows);
  if (SPECIAL_TITLES[g]) return componentCard(a, rows, { title: `${SPECIAL_TITLES[g]} LEDGER CARD`, header: specialHeader(a, g), variant: "ledger", group: g });
  return equipmentLedger(a, rows);
}
/** Property Card for one item (the Property / Supply Office copy). */
export function propertyCardHtml(a, rows) {
  if (a.itemType === "sx") return sxProperty(a, rows);
  const g = specialGroup(a.accountCode);
  if (g === "biological") return biologicalProperty(a, rows);
  if (g === "land") return landProperty(a, rows);
  if (SPECIAL_TITLES[g]) return componentCard(a, rows, { title: `${SPECIAL_TITLES[g]} PROPERTY CARD`, header: specialHeader(a, g), variant: "property", group: g });
  return equipmentProperty(a, rows);
}

/** Property ID tags with a QR code that opens the item's page; `items` = [{ a, url }]. Sized for 3 × 2 in. sticker labels. */
export function idTagsHtml(items) {
  const s = settings();
  return `<div class="tags">${items.map(({ a, url }, i) => `<div class="tag"><div class="qr" data-qr="${esc(url)}" id="qr${i}"></div><div class="tinfo"><div class="xs">${esc(s.entityName)}</div><b>${esc(a.propertyNo || "—")}</b>
    <div>${esc(a.description).slice(0, 80)}</div><div class="xs">${esc(a.holder?.name || "")}${a.holder?.office ? ` · ${esc(a.holder.office)}` : ""}</div><div class="xs">${esc(fundName(a.fund))} · ${shortDate(a.dateAcquired)}</div></div></div>`).join("")}</div>`;
}

/** JEV summary for a depreciation period. */
export function depreciationJevHtml(fund, period, preview, jevNo) {
  const rows = preview.byAccount.flatMap(r => [`<tr><td>${esc(r.expCode)}</td><td>${esc(r.expName)}</td><td class="r">${num(r.amount)}</td><td></td></tr>`,
    `<tr><td>${esc(r.adCode)}</td><td style="padding-left:24px">Accumulated Depreciation — ${esc(r.name)}</td><td></td><td class="r">${num(r.amount)}</td></tr>`]).join("");
  return `<div class="pf">${head("JOURNAL ENTRY VOUCHER — DEPRECIATION")}
    <table class="pmeta-t"><tr><td>Fund Cluster: <b>${esc(fundName(fund))}</b></td><td>JEV No.: <b>${esc(jevNo || "")}</b></td></tr><tr><td>For the month of: <b>${esc(period)}</b></td><td></td></tr></table>
    <table class="pt"><thead><tr><th>UACS Code</th><th>Accounts and Explanation</th><th>Debit</th><th>Credit</th></tr></thead>
      <tbody>${rows}<tr><td></td><td class="r"><b>TOTAL</b></td><td class="r"><b>${num(preview.total)}</b></td><td class="r"><b>${num(preview.total)}</b></td></tr></tbody></table>
    <div class="pf-ref">To record depreciation of property, plant and equipment for ${esc(period)} (straight-line; ${preview.rows.length} items).</div>
    <div class="sig2">${sig("Prepared by:", "", "Signature over Printed Name", "")}${sig("Certified correct:", settings().signatories.accountant, "Signature over Printed Name", settings().signatories.accountantPosition)}</div></div>`;
}

/* ---------------- Construction in Progress and repairs ---------------- */
export function cipLedgerHtml(p, billingTotal) {
  let run = 0;
  const cell = v => `<td class="r">${Number(v) ? num(v) : ""}</td>`;
  const rows = (p.billings || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).map(b => {
    run += billingTotal(b);
    return `<tr><td>${fmtDate(b.date)}</td><td>${esc(b.ref)}</td><td>${esc(b.particulars)}${b.swaNo ? `<div class="pf-spec">SWA ${esc(b.swaNo)}</div>` : ""}</td>
      ${cell(b.byContract)}${cell(b.materials)}${cell(b.labor)}${cell(b.overhead)}${cell(b.consultancy)}${cell(b.others)}<td class="r">${num(run)}</td>${cell(b.adjustments)}</tr>`;
  }).join("");
  return `<div class="pf">${head("CONSTRUCTION IN PROGRESS LEDGER CARD")}
    <table class="pmeta-t"><tr><td>Name of Project: <b>${esc(p.name)}</b></td><td>Account Code: <b>${esc(p.accountCode)} ${esc(accountName(p.accountCode))}</b></td></tr>
      <tr><td>Contractor: <b>${esc(p.contractor || "—")}</b></td><td>CIP No.: <b>${esc(p.cipNo)}</b></td></tr>
      <tr><td>Contract Period: <b>${esc(p.contractPeriod || "—")}</b></td><td>Project Cost: <b>${p.projectCost ? num(p.projectCost) : "—"}</b></td></tr>
      <tr><td>Location: <b>${esc(p.location || "—")}</b></td><td>Fund: <b>${esc(fundName(p.fund))}</b></td></tr></table>
    <table class="pt"><thead><tr><th rowspan="2">Date</th><th rowspan="2">Ref.</th><th rowspan="2">Particulars</th><th rowspan="2">Costs By Contract</th><th colspan="5">Costs By Administration</th><th rowspan="2">Total Balance</th><th rowspan="2">Transfers / Adjustments</th></tr>
      <tr><th>Direct Materials</th><th>Direct Labor</th><th>Overhead</th><th>Consultancy</th><th>Others</th></tr></thead>
      <tbody>${rows}${blanks(10 - (p.billings || []).length, 11)}</tbody></table>
    ${p.completed ? `<div class="pf-ref">Transferred to PPE on ${fmtDate(p.completed.date)} — account ${esc(p.completed.accountCode)} ${esc(accountName(p.completed.accountCode))}, ${num(p.completed.total)}.</div>` : ""}</div>`;
}

/** History of Repair for one item: every job order, oldest first, with a grand total. */
export function repairHistoryHtml(a, records) {
  const list = records.slice().sort((x, y) => String(x.jobOrderDate).localeCompare(String(y.jobOrderDate)));
  const latest = list.at(-1) || {};
  const grand = list.reduce((t, r) => t + (Number(r.totalCost) || 0), 0);
  const block = r => `<table class="pmeta-t" style="margin-top:8px"><tr><td>Job Order No./Date: <b>${esc(r.jobOrderNo)} — ${fmtDate(r.jobOrderDate)}</b></td><td>Invoice/PO No./Date: <b>${esc(r.invoiceNo || "—")}${r.invoiceDate ? ` — ${fmtDate(r.invoiceDate)}` : ""}</b></td></tr>
      <tr><td>Nature of repair: <b>${esc(r.nature || "—")}</b></td><td>Supplier: <b>${esc(r.supplier || "—")}</b></td></tr></table>
    <table class="pt"><thead><tr><th style="width:8%">Qty</th><th style="width:10%">Unit</th><th>Spare parts / Materials and Labor</th><th style="width:15%">Cost</th><th style="width:22%">Remarks</th></tr></thead>
      <tbody>${r.parts.map(l => `<tr><td class="r">${Number(l.qty) ? qty(l.qty) : ""}</td><td>${esc(l.unit)}</td><td>${esc(l.description)}</td><td class="r">${num(l.cost)}</td><td>${esc(l.remarks)}</td></tr>`).join("")}
      <tr><td colspan="3" class="r"><b>SUBTOTAL</b></td><td class="r"><b>${num(r.totalCost)}</b></td><td>${r.status === "verified" ? "Verified" : "Not yet verified"}</td></tr></tbody></table>`;
  return `<div class="pf">${head("HISTORY OF REPAIR")}
    <table class="pmeta-t"><tr><td>Make &amp; Model: <b>${esc(latest.makeModel || a?.description || "")}</b></td><td>Unit/Serial No.: <b>${esc(latest.unitSerialNo || "")}</b></td></tr>
      <tr><td>Engine Serial No.: <b>${esc(latest.engineSerialNo || "")}</b></td><td>Plate No.: <b>${esc(latest.plateNo || "")}</b></td></tr>
      <tr><td>Property No.: <b>${esc(a?.propertyNo || latest.propertyNo || "")}</b></td><td>Date acquired: <b>${fmtDate(a?.dateAcquired)}</b></td></tr>
      <tr><td>End User: <b>${esc(latest.endUser || a?.holder?.name || "")}</b></td><td>Designation: <b>${esc(latest.designation || "")}</b></td></tr>
      <tr><td>Office: <b>${esc(latest.office || a?.holder?.office || "")}</b></td><td>Fund: <b>${esc(fundName(a?.fund || latest.fund))}</b></td></tr></table>
    ${list.length ? list.map(block).join("") : `<p>No repairs recorded for this item yet.</p>`}
    ${list.length > 1 ? `<table class="pt"><tr><td class="r" style="width:75%"><b>GRAND TOTAL — ALL REPAIRS</b></td><td class="r"><b>${num(grand)}</b></td></tr></table>` : ""}
    <div class="sig2">${sig("Prepared by:", latest.preparedBy?.name, "Signature over Printed Name", latest.preparedBy?.position)}
      ${sig("Verified by:", latest.verifiedBy?.name, "Signature over Printed Name", latest.verifiedBy?.position)}
      ${sig("Noted by:", latest.notedBy?.name, "Signature over Printed Name", latest.notedBy?.position)}</div></div>`;
}
