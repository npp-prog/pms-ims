// Reports: RSMI, summary by account (for reconciliation with the Trial Balance), and AIR monitoring.
import { S, fundAirs, fundDocs, docsOfAir } from "../state.js";
import { $, $$, esc, money, num, qty, fmtDate, manilaToday, downloadCSV } from "../ui.js";
import { fundName, accountName, CATEGORIES } from "../core/catalog.js";
import { rsmi, postingSummary, AIR_STATUS, POSTING_STATE, round2 } from "../core/logic.js";
import { printForm, rsmiHtml, tableReportHtml } from "../print.js";

const st = { tab: "rsmi", from: manilaToday().slice(0, 8) + "01", to: manilaToday() };

export function reports(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Reports</h1><p>${esc(fundName(S.fund))}. Choose the period, then print or download.</p></div></div>
    <div class="tabs">${[["rsmi", "RSMI"], ["accounts", "Summary by Account"], ["monitor", "AIR Monitoring"]].map(([k, l]) => `<button data-t="${k}" class="${st.tab === k ? "active" : ""}">${l}</button>`).join("")}</div>
    <div class="card"><div class="table-tools" data-nodirty>
      <div><label>From</label><input type="date" id="from" value="${st.from}"></div><div><label>To</label><input type="date" id="to" value="${st.to}"></div>
      <div class="grow"></div><div class="btn-row" style="align-self:flex-end"><button class="btn" id="csv">Download CSV</button><button class="btn primary" id="pr">Print</button></div></div>
      <div id="out"></div></div>`;
  $$(".tabs [data-t]", main).forEach(b => b.onclick = () => { st.tab = b.dataset.t; reports(main); });
  $("#from", main).onchange = e => { st.from = e.target.value; draw(main); };
  $("#to", main).onchange = e => { st.to = e.target.value; draw(main); };
  draw(main);
}
reports.deps = ["r:airs", "r:docs", "fund"];

const inRange = d => (!st.from || d >= st.from) && (!st.to || d <= st.to);

function draw(main) {
  const out = $("#out", main);
  if (st.tab === "rsmi") {
    const r = rsmi(S.d.docs, S.fund, st.from, st.to);
    out.innerHTML = `<p class="small muted">Report of Supplies and Materials Issued: every RIS line issued in the period, with the recapitulation by stock number.</p>
      <div class="table-wrap"><table><thead><tr><th>RIS No.</th><th>Date</th><th>Office</th><th>Stock No.</th><th>Item</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Amount</th></tr></thead>
      <tbody>${r.lines.map(l => `<tr><td>${esc(l.risNo)}</td><td>${fmtDate(l.date)}</td><td>${esc(l.office)}</td><td>${esc(l.stockNo)}</td><td>${esc(l.description)}</td><td class="right">${qty(l.qty)} ${esc(l.unit)}</td><td class="right">${num(l.unitCost)}</td><td class="right">${num(l.amount)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No RIS issued in this period.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="7" class="right">Total</td><td class="right">${money(r.total)}</td></tr></tfoot></table></div>`;
    $("#pr", main).onclick = () => printForm(rsmiHtml(r, S.fund, st.from, st.to), "landscape");
    $("#csv", main).onclick = () => downloadCSV(`RSMI-${S.fund}-${st.from}-${st.to}`, ["RIS No.", "Date", "Office", "Stock No.", "Item", "Unit", "Qty", "Unit Cost", "Amount", "Account"], r.lines.map(l => [l.risNo, l.date, l.office, l.stockNo, l.description, l.unit, l.qty, l.unitCost, l.amount, l.accountCode]));
  } else if (st.tab === "accounts") {
    const acc = new Map();
    const get = (code, cat) => { if (!acc.has(code)) acc.set(code, { code, cat, received: 0, issued: 0, posted: 0 }); return acc.get(code); };
    for (const a of fundAirs()) if (["approved", "issued"].includes(a.status) && inRange(a.acceptance?.dateReceived || a.date))
      for (const l of a.lines) { const r = get(l.accountCode, l.category); r.received = round2(r.received + l.amount); if (l.category === "cons" && a.posting?.posted) r.posted = round2(r.posted + l.amount); }
    for (const d of fundDocs()) if (d.status !== "cancelled" && inRange(d.date))
      for (const l of d.lines) { const r = get(l.accountCode, { par: "ppe", ics: "sx", ris: "cons" }[d.docType]); r.issued = round2(r.issued + l.amount); if (d.docType !== "ris" && d.posting?.posted) r.posted = round2(r.posted + l.amount); }
    const rows = [...acc.values()].sort((a, b) => a.code.localeCompare(b.code));
    const tot = k => rows.reduce((t, r) => t + r[k], 0);
    out.innerHTML = `<p class="small muted">Per account: value received on approved AIRs (by date received), value issued on PAR / ICS / RIS (by date issued), and value posted by Accounting (PAR / ICS when posted; supplies when the AIR receipt is posted). Use it to reconcile with the Trial Balance.</p>
      <div class="table-wrap"><table><thead><tr><th>Account</th><th>Type</th><th class="right">Received (AIR)</th><th class="right">Issued</th><th class="right">Posted</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td><b>${esc(r.code)}</b> ${esc(accountName(r.code))}</td><td>${esc(CATEGORIES[r.cat]?.short || "")}</td><td class="right">${num(r.received)}</td><td class="right">${num(r.issued)}</td><td class="right">${num(r.posted)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Nothing in this period.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2" class="right">Total</td><td class="right">${money(tot("received"))}</td><td class="right">${money(tot("issued"))}</td><td class="right">${money(tot("posted"))}</td></tr></tfoot></table></div>`;
    const headers = ["Account", "Account Name", "Type", "Received", "Issued", "Posted"];
    const data = rows.map(r => [r.code, accountName(r.code), CATEGORIES[r.cat]?.short || "", r.received, r.issued, r.posted]);
    $("#csv", main).onclick = () => downloadCSV(`Summary-by-Account-${S.fund}-${st.from}-${st.to}`, headers, data);
    $("#pr", main).onclick = () => printForm(tableReportHtml("SUMMARY BY ACCOUNT", `${fundName(S.fund)} · ${fmtDate(st.from)} to ${fmtDate(st.to)}`, headers,
      data.map(r => [r[0], r[1], r[2], num(r[3]), num(r[4]), num(r[5])]), ["", "TOTAL", "", num(tot("received")), num(tot("issued")), num(tot("posted"))]), "landscape");
  } else {
    const rows = fundAirs().filter(a => a.status !== "draft" && inRange(a.date)).sort((a, b) => a.date.localeCompare(b.date) || a.airNo.localeCompare(b.airNo))
      .map(a => { const docs = docsOfAir(a.id).filter(d => d.status !== "cancelled"); return { a, docs, ps: postingSummary(a, docs) }; });
    out.innerHTML = `<p class="small muted">Every AIR dated in the period, its stage, the documents issued from it and its Accounting posting status.</p>
      <div class="table-wrap"><table><thead><tr><th>AIR No.</th><th>Date</th><th>Office</th><th>Supplier</th><th class="right">Amount</th><th>Status</th><th>PAR / ICS / RIS</th><th>Posting</th></tr></thead>
      <tbody>${rows.map(({ a, docs, ps }) => `<tr><td><a href="#/airs/${a.id}">${esc(a.airNo)}</a></td><td>${fmtDate(a.date)}</td><td>${esc(a.office)}</td><td>${esc(a.supplier)}</td><td class="right">${num(a.total)}</td>
        <td>${esc(AIR_STATUS[a.status])}</td><td class="small">${docs.map(d => `${d.docType.toUpperCase()} ${esc(d.number)}`).join(", ") || "—"}</td><td>${esc(POSTING_STATE[ps.state])} (${ps.posted}/${ps.total})</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No AIRs in this period.</td></tr>`}</tbody></table></div>`;
    const headers = ["AIR No.", "Date", "Office", "Supplier", "Amount", "Status", "Documents", "Posting"];
    const data = rows.map(({ a, docs, ps }) => [a.airNo, a.date, a.office, a.supplier, a.total, AIR_STATUS[a.status], docs.map(d => `${d.docType.toUpperCase()} ${d.number}`).join("; "), `${POSTING_STATE[ps.state]} (${ps.posted}/${ps.total})`]);
    $("#csv", main).onclick = () => downloadCSV(`AIR-Monitoring-${S.fund}-${st.from}-${st.to}`, headers, data);
    $("#pr", main).onclick = () => printForm(tableReportHtml("AIR MONITORING REPORT", `${fundName(S.fund)} · ${fmtDate(st.from)} to ${fmtDate(st.to)}`, headers, data.map(r => [r[0], fmtDate(r[1]), r[2], r[3], num(r[4]), r[5], r[6], r[7]])), "landscape");
  }
}
