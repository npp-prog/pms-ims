// Printable official forms. Layouts follow the ones already used in PMS (PAR Appendix 51, ICS Annex A.3)
// and IMS (AIR, RIS Appendix 48, Stock Card Appendix 53, Supplies Ledger Card Appendix 9, RSMI Appendix 40).
import { $, esc, fmtDate, num, qty } from "./ui.js";
import { settings } from "./state.js";
import { fundName, accountName } from "./core/catalog.js";

export function printForm(html, orientation = "portrait") {
  $("#print-area").innerHTML = `<style>@page { size: A4 ${orientation}; margin: 10mm; }</style>${html}`;
  setTimeout(() => window.print(), 200);
}

function head(appendix, title) {
  const s = settings();
  return `<div class="pf-annex">${esc(appendix)}</div>
    <div class="ph"><img src="assets/municipal-seal.png" alt="">
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
  return `<div class="pf">${head("", "ACCEPTANCE AND INSPECTION REPORT")}
    <table class="pmeta-t"><tr><td>Entity Name: <b>${esc(s.entityName)}</b></td><td>Fund Cluster: <b>${esc(fundName(a.fund))}</b></td></tr>
      <tr><td>Supplier: <b>${esc(a.supplier)}</b></td><td>AIR No.: <b>${esc(a.airNo || "(draft)")}</b></td></tr>
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
  return `<div class="pf">${head("Appendix 51", "PROPERTY ACKNOWLEDGMENT RECEIPT")}
    <table class="pmeta-t"><tr><td>Dept/Office: <b>${esc(d.recipient?.office || d.office)}</b></td><td></td></tr>
      <tr><td>Fund: <b>${esc(fundName(d.fund))}</b></td><td class="r">PAR No.: <b class="pf-num">${esc(d.number)}</b></td></tr></table>
    <table class="pt"><thead><tr><th style="width:9%">Quantity</th><th style="width:8%">Unit</th><th>Description</th><th style="width:16%">Property Number</th><th style="width:13%">Date Acquired</th><th style="width:14%">Amount</th></tr></thead>
      <tbody>${rows}<tr class="nothing"><td colspan="6">*** NOTHING FOLLOWS ***</td></tr>${blanks(16 - d.lines.length, 6)}
      <tr><td colspan="5" class="r"><b>TOTAL</b></td><td class="r"><b>${num(d.total)}</b></td></tr></tbody></table>
    <div class="pf-ref">Reference: AIR No. ${esc(d.airNo)} · Supplier: ${esc(d.supplier || "")}</div>
    <div class="sig2">${sig("Received by:", d.recipient?.name, "Signature over Printed Name of End User", d.recipient?.position)}
      ${sig("Issued by:", d.issuedBy?.name, "Signature over Printed Name of Supply and/or Property Custodian", d.issuedBy?.position)}</div></div>`;
}

export function icsHtml(d) {
  const s = settings();
  const rows = d.lines.map(l => `<tr><td class="r">${qty(l.qty)}</td><td>${esc(l.unit)}</td><td class="r">${num(l.unitCost)}</td><td class="r">${num(l.amount)}</td>
    <td>${esc(l.description)}${l.specs ? `<div class="pf-spec">${esc(l.specs).replace(/\n/g, "<br>")}</div>` : ""}</td>
    <td class="c">${esc(l.propertyNo)}</td><td class="c">${esc(l.usefulLife)}</td></tr>`).join("");
  return `<div class="pf">${head("Annex A.3", "INVENTORY CUSTODIAN SLIP")}
    <table class="pmeta-t"><tr><td>Entity Name: <b>${esc(s.entityName)} — ${esc(d.recipient?.office || d.office)}</b></td><td></td></tr>
      <tr><td>Fund Cluster: <b>${esc(fundName(d.fund))}</b></td><td class="r">ICS No.: <b class="pf-num">${esc(d.number)}</b></td></tr></table>
    <table class="pt"><thead><tr><th rowspan="2" style="width:8%">Quantity</th><th rowspan="2" style="width:7%">Unit</th><th colspan="2">Amount</th>
      <th rowspan="2">Description</th><th rowspan="2" style="width:13%">Inventory Item No.</th><th rowspan="2" style="width:11%">Estimated Useful Life</th></tr>
      <tr><th style="width:10%">Unit Cost</th><th style="width:11%">Total Cost</th></tr></thead>
      <tbody>${rows}<tr class="nothing"><td colspan="7">*** NOTHING FOLLOWS ***</td></tr>${blanks(16 - d.lines.length, 7)}
      <tr><td colspan="3" class="r"><b>TOTAL</b></td><td class="r"><b>${num(d.total)}</b></td><td colspan="3"></td></tr></tbody></table>
    <div class="pf-ref">Reference: AIR No. ${esc(d.airNo)} · ${d.sxClass === "low" ? "Low-Value" : "High-Value"} Semi-Expendable Property</div>
    <div class="sig2">${sig("Received from:", d.issuedBy?.name, "Signature over Printed Name", d.issuedBy?.position)}
      ${sig("Received by:", d.recipient?.name, "Signature over Printed Name", d.recipient?.position)}</div></div>`;
}

export function risHtml(d) {
  const rows = d.lines.map(l => `<tr><td>${esc(l.stockNo)}</td><td>${esc(l.unit)}</td><td>${esc(l.description)}</td><td class="r">${qty(l.qtyRequested || l.qty)}</td>
    <td class="c">${box(true)}</td><td class="c">${box(false)}</td><td class="r">${qty(l.qty)}</td><td>AIR ${esc(d.airNo)}</td></tr>`).join("");
  const sg = d.approvedBy || {};
  return `<div class="pf">${head("Appendix 48", "REQUISITION AND ISSUE SLIP")}
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
  return `<div class="pf">${head(ledger ? "Appendix 9" : "Appendix 53", ledger ? "SUPPLIES LEDGER CARD" : "STOCK CARD")}
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
  return `<div class="pf">${head("Appendix 40", "REPORT OF SUPPLIES AND MATERIALS ISSUED")}
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
  return `<div class="pf">${head("", title)}${subtitle ? `<div class="c" style="font-size:11px;margin-bottom:6px">${esc(subtitle)}</div>` : ""}
    <table class="pt"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}${totals ? `<tr>${totals.map(v => `<td><b>${esc(v)}</b></td>`).join("")}</tr>` : ""}</tbody></table></div>`;
}
