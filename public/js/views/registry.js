// Inventory Registry of supplies (consumable and for distribution): AIR receipts (and imported beginning balances) less
// RIS issues, with each item's Stock Card and Supplies Ledger Card. Property registers are in property.js.
import { S, can, settings, activeUsers } from "../state.js";
import { $, $$, esc, money, num, qty, fmtDate, manilaToday, renderTable, openModal, downloadCSV, toast, busy, officeSelect } from "../ui.js";
import { fundName, accountName, isDistributionAccount } from "../core/catalog.js";
import { stockCards, numberingFor } from "../core/logic.js";
import { issueRisFromStock } from "../data.js";
import { printForm, stockCardHtml, tableReportHtml } from "../print.js";

const st = { asOf: "" };
const typeOf = c => isDistributionAccount(c.accountCode) ? "dist" : "cons";
const TYPE = { cons: ["Consumable", "b-info"], dist: ["For distribution", "b-gold"] };
const sumMoves = (c, type) => c.moves.filter(m => m.type === type).reduce((t, m) => t + m.qty, 0);
const lastCost = c => [...c.moves].reverse().find(m => m.type === "receipt")?.unitCost || 0;

/** Inventory Registry: every consumable and for-distribution item (supplies) — received on AIRs or brought over from IMS,
 *  less what was issued on RIS — with its Stock Card and Supplies Ledger Card. */
export function stock(main) {
  const asOf = st.asOf || "", canIssue = can("issue") && !asOf, sel = new Set();
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
    id: canIssue ? "stock-issue" : "stock", rows: cards, pageSize: 50, defaultSort: canIssue ? 1 : 0, // the tick box comes first when the GSO can issue
    searchText: c => `${c.stockNo} ${c.description} ${c.accountCode} ${accountName(c.accountCode)}`,
    searchPlaceholder: "Stock No., item, account",
    filters: [
      { key: "ty", label: "Type", options: [["cons", "Consumable"], ["dist", "For distribution"]], test: (c, v) => typeOf(c) === v },
      { key: "a", label: "Account", options: [...new Set(cards.map(c => c.accountCode))].sort().map(c => [c, `${c} ${accountName(c)}`]), test: (c, v) => c.accountCode === v },
      { key: "b", label: "Balance", options: [["on", "On hand"], ["zero", "Fully issued"]], value: "on", test: (c, v) => v === "on" ? c.balQty > 0 : c.balQty <= 0 }
    ],
    columns: [
      ...(canIssue ? [{ label: "", render: c => c.balQty > 0 ? `<input type="checkbox" data-nodirty data-sel="${esc(c.stockNo)}" ${sel.has(c.stockNo) ? "checked" : ""} title="Tick to issue on an RIS">` : "" }] : []),
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
    footer: list => `<tr><td colspan="${canIssue ? 9 : 8}" class="right">Total (${list.length})</td><td class="right">${money(list.reduce((x, c) => x + c.balValue, 0))}</td></tr>`,
    onRow: c => cardModal(c)
  });
  // RIS for the ticked items on hand
  if (canIssue) {
    $(".page-head", main).insertAdjacentHTML("beforeend", `<button class="btn primary" id="ris" disabled>Issue RIS</button>`);
    $("#t", main).addEventListener("click", e => {
      const b = e.target.closest("[data-sel]"); if (!b) return;
      e.stopPropagation(); b.checked ? sel.add(b.dataset.sel) : sel.delete(b.dataset.sel);
      $("#ris", main).disabled = !sel.size; $("#ris", main).textContent = sel.size ? `Issue RIS (${sel.size})` : "Issue RIS";
    }, true);
    $("#ris", main).onclick = () => risModal(cards.filter(c => sel.has(c.stockNo)));
  }
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

/** RIS for supplies on hand, chosen in the Inventory Registry: each quantity is drawn from the posted AIRs holding it. */
function risModal(items) {
  const s = settings(), manual = numberingFor(S.settings, "ris").mode === "manual";
  const m = openModal(`<h2>Requisition and Issue Slip</h2><p class="muted small">Supplies on hand in the Inventory Registry. Each quantity is taken from the AIRs that hold the item, oldest delivery first.</p>
    <form id="rsf" class="grid" novalidate>
      <div class="table-wrap"><table class="lines"><thead><tr><th>Stock No.</th><th>Item</th><th class="right">On hand</th><th class="right">Requested</th><th class="right">Issue qty</th></tr></thead><tbody>
        ${items.map(c => `<tr data-sn="${esc(c.stockNo)}"><td><b>${esc(c.stockNo)}</b></td><td>${esc(c.description)}<div class="xs muted">${esc(c.unit)}</div></td><td class="right">${qty(c.balQty)}</td>
          <td><input type="number" class="w-xs" data-rq min="0" step="any" value="${c.balQty}"></td><td><input type="number" class="w-xs" data-q min="0" max="${c.balQty}" step="any" value=""></td></tr>`).join("")}
      </tbody></table></div>
      <div class="grid g3">
        <div><label class="req">Date issued</label><input type="date" name="date" value="${manilaToday()}"></div>
        ${manual ? `<div><label class="req">RIS No.</label><input name="no_main" placeholder="as on the printed form"></div>` : ""}
        <div><label class="req">Requested / received by</label><input name="rname" list="rulist" autocomplete="off"></div>
        <datalist id="rulist">${activeUsers().map(u => `<option value="${esc(u.displayName)}">${esc(u.office)}</option>`).join("")}</datalist>
        <div><label>Position / designation</label><input name="rpos"></div>
        <div><label>Office</label>${officeSelect("roffice", "", s.offices)}</div>
        <div><label>Responsibility Center Code</label><input name="rcc"></div>
        <div><label>Purpose</label><input name="purpose"></div>
        <div><label>Approved by</label><input name="aname" value="${esc(s.signatories.approver)}"></div><div><label>Designation</label><input name="apos" value="${esc(s.signatories.approverPosition)}"></div>
        <div><label>Issued by</label><input name="iname" value="${esc(s.signatories.propertyCustodian || S.account?.displayName || "")}"></div>
        <div><label>Designation</label><input name="ipos" value="${esc(s.signatories.propertyCustodianPosition)}"></div>
      </div>
      <div class="form-msg err" id="rsm"></div>
      <div class="modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">Issue RIS</button></div></form>`, { size: "wide" });
  const f = $("#rsf", m);
  f.rname.addEventListener("change", () => { const u = activeUsers().find(x => x.displayName === f.rname.value); if (u) { f.rpos.value = u.position || ""; f.roffice.value = u.office || f.roffice.value; } });
  $("[data-x]", m).onclick = () => m.close();
  f.onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    const picks = $$("tbody tr", f).map(tr => ({ stockNo: tr.dataset.sn, qty: Number($("[data-q]", tr).value) || 0, qtyRequested: Number($("[data-rq]", tr).value) || 0 }));
    const over = picks.find(p => p.qty > (items.find(c => c.stockNo === p.stockNo)?.balQty || 0));
    if (over) { $("#rsm", m).textContent = `Only ${qty(items.find(c => c.stockNo === over.stockNo).balQty)} of ${over.stockNo} are on hand.`; return; }
    const header = { date: v.date, purpose: v.purpose || "", numbers: { main: v.no_main },
      recipient: { uid: activeUsers().find(u => u.displayName === v.rname.trim())?.id || "", name: v.rname.trim(), position: v.rpos.trim(), office: v.roffice.trim(), rcc: (v.rcc || "").trim() },
      issuedBy: { name: v.iname.trim(), position: v.ipos.trim() }, approvedBy: { name: (v.aname || "").trim(), position: (v.apos || "").trim() } };
    busy(e.submitter, async () => {
      try { const out = await issueRisFromStock(S.fund, picks, header); m.close(); window.dispatchEvent(new Event("app:clean")); toast(`RIS ${out.number} issued.`, "ok"); location.hash = `#/issuances/${out.id}`; }
      catch (err) { $("#rsm", m).textContent = err.message; throw err; }
    }).catch(() => {});
  };
}
