// Reports: RSMI, summary by account (for reconciliation with the Trial Balance), and AIR monitoring.
import { S, fundAirs, fundDocs, docsOfAir, fundAssets } from "../state.js";
import { $, $$, esc, money, num, qty, fmtDate, manilaToday, downloadCSV, renderTable } from "../ui.js";
import { accumAsOf, impairmentAsOf, periodOf, periodEnd } from "../core/assets.js";
import { printCards } from "./assetforms.js";
import { fundName, accountName, CATEGORIES } from "../core/catalog.js";
import { rsmi, rsmiEntry, rsmiMonths, postingSummary, AIR_STATUS, POSTING_STATE, round2 } from "../core/logic.js";
import { printForm, rsmiHtml, tableReportHtml } from "../print.js";

const st = { tab: "rsmi", from: manilaToday().slice(0, 8) + "01", to: manilaToday(), month: "" };
const monthName = p => new Date(`${p}-01T00:00:00`).toLocaleDateString("en-PH", { month: "long", year: "numeric" });

export function reports(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Reports</h1><p>${esc(fundName(S.fund))}. The RSMI is made monthly by JEV date; for the other reports choose the period. Then print or download.</p></div></div>
    <div class="tabs">${[["rsmi", "RSMI"], ["accounts", "Summary by Account"], ["monitor", "AIR Monitoring"], ["accountability", "Accountability"], ["disposed", "Disposed / Retired"]].map(([k, l]) => `<button data-t="${k}" class="${st.tab === k ? "active" : ""}">${l}</button>`).join("")}</div>
    <div class="card"><div class="table-tools" data-nodirty ${["accountability", "disposed"].includes(st.tab) ? "hidden" : ""}>
      <div ${st.tab === "rsmi" ? "hidden" : ""}><label>From</label><input type="date" id="from" value="${st.from}"></div><div ${st.tab === "rsmi" ? "hidden" : ""}><label>To</label><input type="date" id="to" value="${st.to}"></div>
      <div class="grow"></div><div class="btn-row" style="align-self:flex-end"><button class="btn" id="csv">Download CSV</button><button class="btn primary" id="pr">Print</button></div></div>
      <div id="out"></div></div>`;
  $$(".tabs [data-t]", main).forEach(b => b.onclick = () => { st.tab = b.dataset.t; reports(main); });
  $("#from", main).onchange = e => { st.from = e.target.value; draw(main); };
  $("#to", main).onchange = e => { st.to = e.target.value; draw(main); };
  draw(main);
}
reports.deps = ["r:airs", "r:docs", "r:assets", "r:depr", "r:movements", "r:repairs", "fund"];

const inRange = d => (!st.from || d >= st.from) && (!st.to || d <= st.to);

function draw(main) {
  const out = $("#out", main);
  if (st.tab === "accountability") return accountability(out);
  if (st.tab === "disposed") return disposed(out);
  if (st.tab === "rsmi") {
    // the RSMI is made from the RIS Accounting has not yet posted (by RIS date), for Accounting to post
    const months = rsmiMonths(S.d.docs, S.fund, { unposted: true });
    const range = st.rmode === "range";
    const month = st.month || months[0]?.period || manilaToday().slice(0, 7);
    if (!st.rfrom) { st.rfrom = `${month}-01`; st.rto = periodEnd(month); }
    const from = range ? st.rfrom : `${month}-01`, to = range ? st.rto : periodEnd(month);
    const r = rsmi(S.d.docs, S.fund, from, to, { unposted: true }), je = rsmiEntry(r.lines);
    const entry = `<h4 style="margin:1rem 0 .4rem">Recapitulation — proposed accounting entry</h4>
      <div class="table-wrap"><table><thead><tr><th>Account</th><th>Account title</th><th class="right">Debit</th><th class="right">Credit</th></tr></thead><tbody>
        ${je.debits.map(d => `<tr><td><b>${esc(d.code || "—")}</b></td><td>${esc(d.name)}</td><td class="right">${num(d.amount)}</td><td></td></tr>`).join("")}
        ${je.credits.map(c => `<tr><td><b>${esc(c.code)}</b></td><td style="padding-left:2rem">${esc(c.name)}</td><td></td><td class="right">${num(c.amount)}</td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="2" class="right">Total</td><td class="right">${money(je.total)}</td><td class="right">${money(je.total)}</td></tr></tfoot></table></div>
      <p class="xs muted" style="margin-top:.4rem">To record the supplies and materials issued${range ? ` from ${fmtDate(from)} to ${fmtDate(to)}` : ` for ${esc(monthName(month))}`} per RSMI.</p>`;
    out.innerHTML = `<p class="small muted">The RSMI is made from the RIS that Accounting has <b>not yet posted</b>, by RIS date. Once Accounting posts an RIS it no longer appears here. Choose a month, or any date coverage.</p>
      <div class="tabs" data-nodirty><button type="button" data-rmode="month" class="${range ? "" : "active"}">By month</button><button type="button" data-rmode="range" class="${range ? "active" : ""}">By date coverage</button></div>
      <div class="split rep-split">
        <div><div class="table-wrap"><table><thead><tr><th>Month</th><th class="right">RIS</th><th class="right">Amount</th></tr></thead>
          <tbody>${months.map(m => `<tr class="click ${m.period === month ? "sel" : ""}" data-m="${esc(m.period)}"><td><b>${esc(monthName(m.period))}</b><div class="xs muted">RSMI No. ${esc(m.period)}</div></td><td class="right">${m.ris}</td><td class="right">${num(m.total)}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">No RIS waiting to be posted.</td></tr>`}</tbody></table></div>
          <div style="margin-top:.6rem" data-nodirty><label>Other month</label><input type="month" id="rm" value="${esc(month)}"></div>
          </div>
        <div>${range ? `<div class="table-tools" data-nodirty><div><label>From (RIS date)</label><input type="date" id="rf" value="${esc(from)}"></div><div><label>To</label><input type="date" id="rt" value="${esc(to)}"></div></div>
          <h3 style="margin:0 0 .2rem">RSMI — ${fmtDate(from)} to ${fmtDate(to)}</h3>` : `<h3 style="margin:0 0 .2rem">RSMI No. ${esc(month)} — ${esc(monthName(month))}</h3>`}
          <p class="xs muted" style="margin:0 0 .6rem">${r.lines.length ? "RIS not yet posted by Accounting" : "No RIS waiting to be posted in this period."}</p>
          <div class="table-wrap"><table><thead><tr><th>RIS No.</th><th>RIS date</th><th>Office</th><th>Stock No.</th><th>Item</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Amount</th></tr></thead>
          <tbody>${r.lines.map(l => `<tr><td>${esc(l.risNo)}</td><td>${fmtDate(l.date)}</td><td>${esc(l.office)}</td><td>${esc(l.stockNo)}</td><td>${esc(l.description)}</td><td class="right">${qty(l.qty)} ${esc(l.unit)}</td><td class="right">${num(l.unitCost)}</td><td class="right">${num(l.amount)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">Nothing in this month.</td></tr>`}</tbody>
          <tfoot><tr><td colspan="7" class="right">Total</td><td class="right">${money(r.total)}</td></tr></tfoot></table></div>${r.lines.length ? entry : ""}</div></div>`;
    $$("[data-rmode]", out).forEach(b => b.onclick = () => { st.rmode = b.dataset.rmode; draw(main); });
    $("#rf", out) && ($("#rf", out).onchange = e => { st.rfrom = e.target.value; if (st.rto < st.rfrom) st.rto = st.rfrom; draw(main); });
    $("#rt", out) && ($("#rt", out).onchange = e => { st.rto = e.target.value; draw(main); });
    $$("[data-m]", out).forEach(tr => tr.onclick = () => { st.month = tr.dataset.m; st.rmode = "month"; draw(main); });
    $("#rm", out).onchange = e => { if (e.target.value) { st.month = e.target.value; st.rmode = "month"; draw(main); } };
    $("#pr", main).onclick = () => printForm(rsmiHtml(r, S.fund, from, to, range ? { entry: je } : { month, entry: je }), "portrait");
    $("#csv", main).onclick = () => downloadCSV(`RSMI-${S.fund}-${range ? `${from}_to_${to}` : month}`, ["RSMI No.", "RIS No.", "RIS Date", "JEV No.", "JEV Date", "Office", "Stock No.", "Item", "Unit", "Qty", "Unit Cost", "Amount", "Account"],
      r.lines.map(l => [range ? `${from} to ${to}` : month, l.risNo, l.date, l.jevNo, l.jevDate, l.office, l.stockNo, l.description, l.unit, l.qty, l.unitCost, l.amount, l.accountCode]));
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

/* ---------------- property accountability (PMS reports) ---------------- */
const per = () => periodOf(manilaToday());
const carrying = a => a.itemType === "ppe" ? Math.round((a.cost - accumAsOf(a, per(), S.d.depr) - impairmentAsOf(a, per())) * 100) / 100 : a.cost;
const STATUS_NAMES = { active: "In use", returned: "Returned to GSO", disposed: "Disposed" };

function accountability(out) {
  const rows = fundAssets().filter(a => a.status !== "cancelled");
  out.innerHTML = `<p class="small muted">Property by accountable officer and office, as of today. Filter, then download, print the list, or print the Ledger / Property Cards of the items listed.</p>
    <div id="at"></div><div class="btn-row end"><button class="btn sm" id="alc">Ledger Cards</button><button class="btn sm" id="apc">Property Cards</button><button class="btn sm" id="atg">ID tags</button><button class="btn sm" id="acsv">CSV</button><button class="btn sm primary" id="apr">Print list</button></div>`;
  const officers = [...new Set(rows.map(a => a.holder?.name).filter(Boolean))].sort();
  const offices = [...new Set(rows.map(a => a.holder?.office).filter(Boolean))].sort();
  const t = renderTable($("#at", out), {
    id: "accountability", rows, pageSize: 50, defaultSort: 0,
    searchText: a => `${a.propertyNo} ${a.description} ${a.holder?.name} ${a.holder?.office} ${a.articleType}`,
    filters: [
      { key: "c", label: "Category", options: [["ppe", "PPE"], ["sx", "Semi-expendable"]], test: (a, v) => a.itemType === v },
      { key: "t", label: "Account", options: [...new Set(rows.map(a => a.accountCode))].sort().map(c => [c, `${c} ${accountName(c)}`]), test: (a, v) => a.accountCode === v },
      { key: "o", label: "Officer", options: [["__none", "No officer"], ...officers], test: (a, v) => v === "__none" ? !a.holder?.name : a.holder?.name === v },
      { key: "f", label: "Office", options: [...offices.map(x => [x, x]), ["__none", "No office"]], test: (a, v) => v === "__none" ? !String(a.holder?.office || "").trim() : a.holder?.office === v },
      { key: "s", label: "Status", options: [["onhand", "On hand"], ...Object.entries(STATUS_NAMES)], value: "onhand", test: (a, v) => v === "onhand" ? a.status !== "disposed" : a.status === v }
    ],
    columns: [
      { label: "Accountable officer", render: a => `${esc(a.holder?.name || "—")}<div class="xs muted">${esc(a.holder?.office || "")}</div>`, sort: a => `${a.holder?.name || "~"} ${a.propertyNo}` },
      { label: "Property / Item No.", render: a => esc(a.propertyNo || "—"), sort: a => a.propertyNo || "" },
      { label: "Description", render: a => `${esc(a.description)}<div class="xs muted">${esc(a.accountCode)} ${esc(accountName(a.accountCode))}</div>`, sort: a => a.description },
      { label: "Acquired", render: a => fmtDate(a.dateAcquired), sort: a => a.dateAcquired || "" },
      { label: "Cost", render: a => num(a.cost), sort: a => a.cost, cls: "right", headCls: "right" },
      { label: "Carrying", render: a => num(carrying(a)), sort: a => carrying(a), cls: "right", headCls: "right" },
      { label: "Status", render: a => esc(STATUS_NAMES[a.status] || a.status) }
    ],
    empty: "No property matches.",
    footer: l => `<tr><td colspan="4" class="right">Total (${l.length})</td><td class="right">${money(l.reduce((t, a) => t + a.cost, 0))}</td><td class="right">${money(l.reduce((t, a) => t + carrying(a), 0))}</td><td></td></tr>`,
    onRow: a => { location.hash = `#/assets/${a.id}`; }
  });
  const headers = ["Accountable Officer", "Office", "Category", "Property/Item No.", "Description", "Account", "Date Acquired", "Qty", "Unit", "Cost", "Carrying Amount", "Status", "PAR/ICS"];
  const data = () => t.rows().map(a => [a.holder?.name || "", a.holder?.office || "", a.itemType === "ppe" ? "PPE" : "Semi-expendable", a.propertyNo, a.description, a.accountCode, a.dateAcquired, a.qty, a.unit, a.cost, carrying(a), STATUS_NAMES[a.status] || a.status, a.parIcs?.number || a.source?.number || ""]);
  $("#acsv", out).onclick = () => downloadCSV(`Accountability-${S.fund}-${manilaToday()}`, headers, data());
  $("#apr", out).onclick = () => printForm(tableReportHtml("REPORT ON PROPERTY ACCOUNTABILITY", `${fundName(S.fund)} · as of ${fmtDate(manilaToday())}`,
    ["Accountable Officer", "Office", "Property No.", "Description", "Acquired", "Cost", "Carrying", "Status"], data().map(r => [r[0], r[1], r[3], r[4], fmtDate(r[6]), num(r[9]), num(r[10]), r[11]]),
    ["", "", "", `TOTAL (${t.rows().length})`, "", num(t.rows().reduce((x, a) => x + a.cost, 0)), num(t.rows().reduce((x, a) => x + carrying(a), 0)), ""]), "landscape");
  $("#alc", out).onclick = () => printCards(t.rows(), "ledger");
  $("#apc", out).onclick = () => printCards(t.rows(), "property");
  $("#atg", out).onclick = () => printCards(t.rows(), "tags");
}

function disposed(out) {
  const rows = fundAssets().filter(a => a.status === "disposed");
  const carryingAt = a => { const m = S.d.movements.find(x => x.id === a.disposal?.movementId); const l = m?.lines.find(x => x.assetId === a.id); return l ? l.carrying : null; };
  out.innerHTML = `<p class="small muted">Items disposed of, donated or otherwise derecognized, with their disposal reference. Accounting can reactivate an item disposed of by mistake from its page.</p><div id="dt"></div>
    <div class="btn-row end"><button class="btn sm" id="dcsv">CSV</button><button class="btn sm primary" id="dpr">Print list</button></div>`;
  const t = renderTable($("#dt", out), {
    id: "disposed", rows, pageSize: 50, defaultSort: 0, defaultDir: -1,
    searchText: a => `${a.propertyNo} ${a.description} ${a.disposal?.reason} ${a.disposal?.ref} ${a.holder?.name}`,
    filters: [{ key: "c", label: "Category", options: [["ppe", "PPE"], ["sx", "Semi-expendable"]], test: (a, v) => a.itemType === v }],
    columns: [
      { label: "Disposed", render: a => fmtDate(a.disposal?.date), sort: a => a.disposal?.date || "" },
      { label: "Property / Item No.", render: a => esc(a.propertyNo || "—"), sort: a => a.propertyNo || "" },
      { label: "Description", render: a => `${esc(a.description)}<div class="xs muted">${esc(a.accountCode)}</div>`, sort: a => a.description },
      { label: "Mode / reference", render: a => `${esc(a.disposal?.reason || "—")}<div class="xs muted">${esc(a.disposal?.ref || "")}</div>` },
      { label: "Last officer", render: a => esc(a.holder?.name || "—") },
      { label: "Cost", render: a => num(a.cost), sort: a => a.cost, cls: "right", headCls: "right" },
      { label: "Carrying at disposal", render: a => carryingAt(a) == null ? "—" : num(carryingAt(a)), cls: "right", headCls: "right" }
    ],
    empty: "Nothing disposed of in this fund.",
    footer: l => `<tr><td colspan="5" class="right">Total (${l.length})</td><td class="right">${money(l.reduce((t, a) => t + a.cost, 0))}</td><td></td></tr>`,
    onRow: a => { location.hash = `#/assets/${a.id}`; }
  });
  const headers = ["Date Disposed", "Property/Item No.", "Description", "Account", "Category", "Mode", "Reference", "Last Accountable Officer", "Cost", "Carrying Amount at Disposal"];
  const data = () => t.rows().map(a => [a.disposal?.date || "", a.propertyNo, a.description, a.accountCode, a.itemType === "ppe" ? "PPE" : "Semi-expendable", a.disposal?.reason || "", a.disposal?.ref || "", a.holder?.name || "", a.cost, carryingAt(a) ?? ""]);
  $("#dcsv", out).onclick = () => downloadCSV(`Disposed-${S.fund}-${manilaToday()}`, headers, data());
  $("#dpr", out).onclick = () => printForm(tableReportHtml("DISPOSED / RETIRED PROPERTY", `${fundName(S.fund)} · as of ${fmtDate(manilaToday())}`,
    ["Disposed", "Property No.", "Description", "Mode", "Reference", "Last Officer", "Cost", "Carrying"], data().map(r => [fmtDate(r[0]), r[1], r[2], r[5], r[6], r[7], num(r[8]), r[9] === "" ? "" : num(r[9])])), "landscape");
}
