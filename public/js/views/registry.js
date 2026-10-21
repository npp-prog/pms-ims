// Registries built from the issued documents: PPE (PAR), Semi-Expendable (ICS) and Supplies stock cards (AIR receipts − RIS).
import { S, fundDocs } from "../state.js";
import { $, esc, money, num, qty, fmtDate, renderTable, openModal, downloadCSV } from "../ui.js";
import { fundName, accountName } from "../core/catalog.js";
import { stockCards } from "../core/logic.js";
import { printForm, stockCardHtml, tableReportHtml } from "../print.js";

function propertyRows(docType) {
  return fundDocs().filter(d => d.docType === docType && d.status !== "cancelled").flatMap(d => d.lines.map((l, i) => ({
    key: `${d.id}-${i}`, docId: d.id, number: d.number, date: d.date, airNo: d.airNo, cls: d.sxClass, posted: !!d.posting?.posted, postRef: d.posting?.ref || "",
    officer: d.recipient?.name || "", office: d.recipient?.office || "", ...l
  })));
}

function propertyRegistry(main, docType) {
  const ppe = docType === "par";
  const rows = propertyRows(docType);
  const title = ppe ? "Property, Plant & Equipment Registry" : "Semi-Expendable Property Registry";
  main.innerHTML = `<div class="page-head"><div><h1>${title}</h1><p>Every item issued on a ${ppe ? "PAR" : "ICS"} in the ${esc(fundName(S.fund))}, with the accountable officer and whether Accounting has posted it.</p></div>
    <div class="btn-row"><button class="btn" id="csv">Download CSV</button><button class="btn" id="pr">Print</button></div></div><div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "reg-" + docType, rows, pageSize: 50, defaultSort: 0, defaultDir: -1,
    searchText: r => `${r.number} ${r.propertyNo} ${r.description} ${r.specs} ${r.officer} ${r.office} ${r.accountCode} ${r.airNo}`,
    searchPlaceholder: "Property no., item, officer, office",
    filters: [
      { key: "a", label: "Account", options: [...new Set(rows.map(r => r.accountCode))].sort().map(c => [c, `${c} ${accountName(c)}`]), test: (r, v) => r.accountCode === v },
      { key: "p", label: "Accounting", options: [["y", "Posted"], ["n", "Not posted"]], test: (r, v) => r.posted === (v === "y") },
      ...(ppe ? [] : [{ key: "c", label: "Class", options: [["low", "Low-Value (SPLV)"], ["high", "High-Value (SPHV)"]], test: (r, v) => r.cls === v }])
    ],
    columns: [
      { label: "Date", render: r => fmtDate(r.date), sort: r => r.date },
      { label: ppe ? "PAR No." : "ICS No.", render: r => `<a href="#/issuances/${r.docId}">${esc(r.number)}</a>`, sort: r => r.number },
      { label: ppe ? "Property No." : "Item No.", render: r => esc(r.propertyNo || "—"), sort: r => r.propertyNo || "" },
      { label: "Description", render: r => `<b>${esc(r.description)}</b><div class="xs muted">${esc(r.accountCode)} ${esc(accountName(r.accountCode))}</div>`, sort: r => r.description },
      { label: "Qty", render: r => `${qty(r.qty)} ${esc(r.unit)}`, cls: "right" },
      { label: "Amount", render: r => money(r.amount), sort: r => r.amount, cls: "right", headCls: "right" },
      { label: "Accountable officer", render: r => `${esc(r.officer)}<div class="xs muted">${esc(r.office)}</div>`, sort: r => r.officer },
      { label: "Accounting", render: r => r.posted ? `<span class="badge b-ok">Posted</span><div class="xs muted">${esc(r.postRef)}</div>` : `<span class="badge b-warn">Not posted</span>` }
    ],
    empty: `Nothing issued on a ${ppe ? "PAR" : "ICS"} in this fund yet.`,
    footer: list => `<tr><td colspan="5" class="right">Total</td><td class="right">${money(list.reduce((s, r) => s + r.amount, 0))}</td><td colspan="2"></td></tr>`
  });
  const headers = ["Date", ppe ? "PAR No." : "ICS No.", ppe ? "Property No." : "Item No.", "Description", "Account", "Qty", "Unit", "Unit Cost", "Amount", "Accountable Officer", "Office", "AIR No.", "Posted"];
  const data = () => t.rows().map(r => [r.date, r.number, r.propertyNo, r.description, r.accountCode, r.qty, r.unit, r.unitCost, r.amount, r.officer, r.office, r.airNo, r.posted ? r.postRef || "Yes" : "No"]);
  $("#csv", main).onclick = () => downloadCSV(`${ppe ? "PPE" : "SemiExpendable"}-Registry-${S.fund}`, headers, data());
  $("#pr", main).onclick = () => printForm(tableReportHtml(title.toUpperCase(), fundName(S.fund),
    ["Date", ppe ? "PAR No." : "ICS No.", "Property/Item No.", "Description", "Account", "Qty", "Amount", "Accountable Officer", "Posted"],
    t.rows().map(r => [fmtDate(r.date), r.number, r.propertyNo, r.description, r.accountCode, `${qty(r.qty)} ${r.unit}`, num(r.amount), r.officer, r.posted ? r.postRef || "Yes" : "No"]),
    ["", "", "", "TOTAL", "", "", num(t.rows().reduce((s, r) => s + r.amount, 0)), "", ""]), "landscape");
}

export function ppe(main) { propertyRegistry(main, "par"); }
ppe.deps = ["r:docs", "fund"];
export function sx(main) { propertyRegistry(main, "ics"); }
sx.deps = ["r:docs", "fund"];

export function stock(main) {
  const cards = stockCards(S.d.airs, S.d.docs, S.fund);
  main.innerHTML = `<div class="page-head"><div><h1>Supplies Stock Cards</h1><p>Supplies received through approved AIRs less what was issued on RIS, per stock number, in the ${esc(fundName(S.fund))}. Open an item for its Stock Card (GSO) and Supplies Ledger Card (Accounting).</p></div>
    <button class="btn" id="csv">Download CSV</button></div><div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "stock", rows: cards, pageSize: 50, defaultSort: 0,
    searchText: c => `${c.stockNo} ${c.description} ${c.accountCode}`,
    filters: [{ key: "b", label: "Balance", options: [["on", "With balance"], ["zero", "Fully issued"]], value: "on", test: (c, v) => v === "on" ? c.balQty > 0 : c.balQty <= 0 }],
    columns: [
      { label: "Stock No.", render: c => `<b>${esc(c.stockNo)}</b>`, sort: c => c.stockNo },
      { label: "Description", render: c => `${esc(c.description)}<div class="xs muted">${esc(c.accountCode)} ${esc(accountName(c.accountCode))}</div>`, sort: c => c.description },
      { label: "Unit", render: c => esc(c.unit) },
      { label: "Balance qty", render: c => qty(c.balQty), sort: c => c.balQty, cls: "right", headCls: "right" },
      { label: "Balance value", render: c => money(c.balValue), sort: c => c.balValue, cls: "right", headCls: "right" }
    ],
    empty: "No supplies received in this fund yet.",
    footer: list => `<tr><td colspan="4" class="right">Total</td><td class="right">${money(list.reduce((s, c) => s + c.balValue, 0))}</td></tr>`,
    onRow: c => cardModal(c)
  });
  $("#csv", main).onclick = () => downloadCSV(`Stock-${S.fund}`, ["Stock No.", "Description", "Unit", "Account", "Balance Qty", "Balance Value"], t.rows().map(c => [c.stockNo, c.description, c.unit, c.accountCode, c.balQty, c.balValue]));
}
stock.deps = ["r:airs", "r:docs", "fund"];

function cardModal(c) {
  const m = openModal(`<h2>${esc(c.stockNo)} — ${esc(c.description)}</h2><p class="muted small">${esc(c.accountCode)} ${esc(accountName(c.accountCode))} · balance ${qty(c.balQty)} ${esc(c.unit)} · ${money(c.balValue)}</p>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Reference</th><th class="right">Receipt</th><th class="right">Issue</th><th>Office</th><th class="right">Unit cost</th><th class="right">Balance qty</th><th class="right">Balance value</th></tr></thead>
    <tbody>${c.moves.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.ref)}</td><td class="right">${x.type === "receipt" ? qty(x.qty) : ""}</td><td class="right">${x.type === "issue" ? qty(x.qty) : ""}</td>
      <td class="small">${x.type === "issue" ? esc(x.office) : ""}</td><td class="right">${num(x.unitCost)}</td><td class="right">${qty(x.balQty)}</td><td class="right">${num(x.balValue)}</td></tr>`).join("")}</tbody></table></div>
    <div class="modal-actions"><button class="btn" id="sc">Print Stock Card</button><button class="btn" id="slc">Print Supplies Ledger Card</button><button class="btn primary" data-x>Close</button></div>`, { size: "wide" });
  $("[data-x]", m).onclick = () => m.close();
  $("#sc", m).onclick = () => printForm(stockCardHtml(c, S.fund, false), "landscape");
  $("#slc", m).onclick = () => printForm(stockCardHtml(c, S.fund, true), "landscape");
}
