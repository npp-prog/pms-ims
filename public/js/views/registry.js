// Inventory Registry of supplies (consumable and for distribution): AIR receipts (and imported beginning balances) less
// RIS issues, with each item's Stock Card and Supplies Ledger Card. Property registers are in property.js.
import { S } from "../state.js";
import { $, esc, money, num, qty, fmtDate, renderTable, openModal, downloadCSV, toast } from "../ui.js";
import { fundName, accountName, isDistributionAccount } from "../core/catalog.js";
import { stockCards } from "../core/logic.js";
import { printForm, stockCardHtml, tableReportHtml } from "../print.js";

const st = { asOf: "" };
const typeOf = c => isDistributionAccount(c.accountCode) ? "dist" : "cons";
const TYPE = { cons: ["Consumable", "b-info"], dist: ["For distribution", "b-gold"] };
const sumMoves = (c, type) => c.moves.filter(m => m.type === type).reduce((t, m) => t + m.qty, 0);
const lastCost = c => [...c.moves].reverse().find(m => m.type === "receipt")?.unitCost || 0;

/** Inventory Registry: every consumable and for-distribution item (supplies) — received on AIRs or brought over from IMS,
 *  less what was issued on RIS — with its Stock Card and Supplies Ledger Card. */
export function stock(main) {
  const asOf = st.asOf || "";
  const cards = stockCards(S.d.airs, S.d.docs, S.fund, asOf).filter(c => c.moves.length);
  const val = t => cards.filter(c => typeOf(c) === t).reduce((x, c) => x + c.balValue, 0);
  main.innerHTML = `<div class="page-head"><div><h1>Inventory Registry</h1><p>Consumable and for-distribution items in the ${esc(fundName(S.fund))}: received on approved AIRs (or brought over from IMS), less what was issued on RIS — one row per Stock No. Open an item for its Stock Card (GSO) and Supplies Ledger Card (Accounting).</p></div></div>
    <div class="stats">
      <div class="stat"><span class="n">${cards.filter(c => c.balQty > 0).length}</span><span class="l">Items on hand</span></div>
      <div class="stat"><span class="n">${money(val("cons"))}</span><span class="l">Consumable — on hand</span></div>
      <div class="stat"><span class="n">${money(val("dist"))}</span><span class="l">For distribution — on hand</span></div>
      <div class="stat"><span class="n">${money(val("cons") + val("dist"))}</span><span class="l">Total inventory${asOf ? ` as of ${fmtDate(asOf)}` : ""}</span></div></div>
    <div class="card"><div class="table-tools" data-nodirty><div><label>As of</label><input type="date" id="asof" value="${esc(asOf)}"></div><div class="grow small muted" style="align-self:center">${asOf ? "Balances at the end of that day." : "Leave blank for today's balances."}</div></div><div id="t"></div></div>
    <div class="btn-row end"><span class="small muted" style="align-self:center">For the items listed (filters apply):</span><button class="btn sm" id="bsc">Stock Cards</button><button class="btn sm" id="bslc">Supplies Ledger Cards</button><button class="btn sm" id="csv">CSV</button><button class="btn sm primary" id="pr">Print registry</button></div>`;
  const t = renderTable($("#t", main), {
    id: "stock", rows: cards, pageSize: 50, defaultSort: 0,
    searchText: c => `${c.stockNo} ${c.description} ${c.accountCode} ${accountName(c.accountCode)}`,
    searchPlaceholder: "Stock No., item, account",
    filters: [
      { key: "ty", label: "Type", options: [["cons", "Consumable"], ["dist", "For distribution"]], test: (c, v) => typeOf(c) === v },
      { key: "a", label: "Account", options: [...new Set(cards.map(c => c.accountCode))].sort().map(c => [c, `${c} ${accountName(c)}`]), test: (c, v) => c.accountCode === v },
      { key: "b", label: "Balance", options: [["on", "On hand"], ["zero", "Fully issued"]], value: "on", test: (c, v) => v === "on" ? c.balQty > 0 : c.balQty <= 0 }
    ],
    columns: [
      { label: "Stock No.", render: c => `<b>${esc(c.stockNo || "—")}</b>`, sort: c => c.stockNo },
      { label: "Description", render: c => `${esc(c.description)}<div class="xs muted">${esc(c.accountCode)} ${esc(accountName(c.accountCode))}</div>`, sort: c => c.description },
      { label: "Type", render: c => `<span class="badge ${TYPE[typeOf(c)][1]}">${TYPE[typeOf(c)][0]}</span>`, sort: c => typeOf(c) },
      { label: "Unit", render: c => esc(c.unit) },
      { label: "Received", render: c => qty(sumMoves(c, "receipt")), sort: c => sumMoves(c, "receipt"), cls: "right", headCls: "right" },
      { label: "Issued", render: c => qty(sumMoves(c, "issue")), sort: c => sumMoves(c, "issue"), cls: "right", headCls: "right" },
      { label: "Balance", render: c => `<b>${qty(c.balQty)}</b>`, sort: c => c.balQty, cls: "right", headCls: "right" },
      { label: "Unit cost", render: c => num(lastCost(c)), cls: "right", headCls: "right" },
      { label: "Value", render: c => money(c.balValue), sort: c => c.balValue, cls: "right", headCls: "right" }
    ],
    empty: "No supplies in this view.",
    footer: list => `<tr><td colspan="8" class="right">Total (${list.length})</td><td class="right">${money(list.reduce((x, c) => x + c.balValue, 0))}</td></tr>`,
    onRow: c => cardModal(c)
  });
  $("#asof", main).onchange = e => { st.asOf = e.target.value; stock(main); };
  const headers = ["Stock No.", "Description", "Type", "Account", "Unit", "Received", "Issued", "Balance Qty", "Unit Cost", "Balance Value"];
  const data = () => t.rows().map(c => [c.stockNo, c.description, TYPE[typeOf(c)][0], c.accountCode, c.unit, sumMoves(c, "receipt"), sumMoves(c, "issue"), c.balQty, lastCost(c), c.balValue]);
  $("#csv", main).onclick = () => downloadCSV(`Inventory-Registry-${S.fund}-${asOf || "today"}`, headers, data());
  $("#pr", main).onclick = () => printForm(tableReportHtml("INVENTORY REGISTRY — SUPPLIES (CONSUMABLE AND FOR DISTRIBUTION)", `${fundName(S.fund)} · as of ${fmtDate(asOf || new Date())}`,
    headers, data().map(r => [r[0], r[1], r[2], `${r[3]} ${accountName(r[3])}`, r[4], qty(r[5]), qty(r[6]), qty(r[7]), num(r[8]), num(r[9])]),
    ["", `TOTAL (${t.rows().length})`, "", "", "", "", "", "", "", num(t.rows().reduce((x, c) => x + c.balValue, 0))]), "landscape");
  const bulk = ledger => { const list = t.rows(); if (!list.length) return toast("No items to print.", "err"); printForm(list.map(c => stockCardHtml(c, S.fund, ledger)).join(""), "landscape"); };
  $("#bsc", main).onclick = () => bulk(false);
  $("#bslc", main).onclick = () => bulk(true);
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
