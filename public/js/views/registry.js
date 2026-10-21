// Supplies stock cards: AIR receipts (and imported beginning balances) less RIS issues. Property registers are in property.js.
import { S } from "../state.js";
import { $, esc, money, num, qty, fmtDate, renderTable, openModal, downloadCSV } from "../ui.js";
import { fundName, accountName } from "../core/catalog.js";
import { stockCards } from "../core/logic.js";
import { printForm, stockCardHtml } from "../print.js";

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
