// Accounting: monthly depreciation (straight-line, posted per period with its JEV) and Trial Balance reconciliation.
import { S, can, fundRuns } from "../state.js";
import { $, esc, busy, toast, money, num, fmtDate, fmtDateTime, manilaToday, confirmBox, downloadCSV, sheetAsText } from "../ui.js";
import { fundName, accountName, CATEGORIES } from "../core/catalog.js";
import { depreciationFor, lastPosted, checkPostPeriod, addMonths, periodOf, periodEnd, parseTrialBalance, reconcile, isPeriod } from "../core/assets.js";
import { stockCards, round2 } from "../core/logic.js";
import { postDepreciation, unpostDepreciation, saveTrialBalance } from "../data.js";
import { printForm, depreciationJevHtml, tableReportHtml } from "../print.js";

const st = { dep: null, rec: null };

/* ---------------- depreciation ---------------- */
export function depreciation(main) {
  const runs = fundRuns(), last = lastPosted(S.d.depr, S.fund);
  const period = st.dep && isPeriod(st.dep) ? st.dep : last ? addMonths(last, 1) : addMonths(periodOf(manilaToday()), -1);
  const posted = runs.find(r => r.period === period);
  const preview = posted ? { rows: Object.entries(posted.amounts || {}).map(([id, amount]) => { const a = S.d.assets.find(x => x.id === id) || {}; return { id, amount, propertyNo: a.propertyNo, description: a.description || "(record not found)", accountCode: a.accountCode }; }), byAccount: posted.byAccount, total: posted.total }
    : depreciationFor(S.d.assets, S.fund, period, S.d.depr);
  const err = posted ? "" : checkPostPeriod(S.d.depr, S.fund, period, manilaToday());
  main.innerHTML = `<div class="page-head"><div><h1>Depreciation</h1><p>Straight-line, monthly, as in PMS: (cost − residual value) ÷ useful life, starting the month after acquisition (or after the imported balance) and stopping at the residual value. Periods are posted in order.</p></div></div>
    <div class="card"><div class="table-tools" data-nodirty>
      <div><label>Period</label><input type="month" id="per" value="${period}"></div>
      <div class="grow small muted" style="align-self:center">${esc(fundName(S.fund))} · last posted: <b>${esc(last || "none yet")}</b>${last ? ` · next: <b>${esc(addMonths(last, 1))}</b>` : ""}</div>
      <div class="btn-row" style="align-self:flex-end"><button class="btn" id="csv">CSV</button><button class="btn" id="jev">Print JEV</button></div></div>
      ${posted ? `<div class="notice ok">Posted · JEV ${esc(posted.jevNo)} · ${fmtDateTime(posted.postedAt)} by ${esc(posted.postedBy?.name)}</div>`
        : err ? `<div class="notice warn">${esc(err)}</div>` : ""}
      <h3>JEV summary — ${money(preview.total)}</h3>
      <div class="table-wrap"><table><thead><tr><th>Account</th><th class="right">Items</th><th>Debit (expense)</th><th>Credit (accumulated depreciation)</th><th class="right">Amount</th></tr></thead>
        <tbody>${preview.byAccount.map(r => `<tr><td><b>${esc(r.code)}</b> ${esc(r.name)}</td><td class="right">${r.count}</td><td class="small">${esc(r.expCode)} ${esc(r.expName)}</td><td class="small">${esc(r.adCode)}</td><td class="right">${num(r.amount)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Nothing to depreciate for this period.</td></tr>`}</tbody>
        <tfoot><tr><td colspan="4" class="right">Total</td><td class="right">${money(preview.total)}</td></tr></tfoot></table></div>
      ${can("post") && !posted && !err && preview.rows.length ? `<form class="btn-row" id="pf" style="margin-top:1rem;justify-content:flex-end"><input name="jev" placeholder="JEV No." style="width:220px" data-nodirty><button class="btn primary" type="submit">Post ${esc(period)}</button></form>` : ""}
      ${can("post") && posted && posted.period === last ? `<div class="btn-row end" style="margin-top:1rem"><button class="btn danger" id="un">Unpost ${esc(period)}</button></div>` : ""}
    </div>
    <details class="card"><summary><b>Items (${preview.rows.length})</b> — show each record's depreciation</summary><div class="table-wrap" style="margin-top:.8rem"><table><thead><tr><th>Property No.</th><th>Description</th><th>Account</th><th class="right">Depreciation</th></tr></thead>
      <tbody>${preview.rows.map(r => `<tr class="click" onclick="location.hash='#/assets/${esc(r.id)}'"><td>${esc(r.propertyNo || "—")}</td><td>${esc(r.description)}</td><td>${esc(r.accountCode)}</td><td class="right">${num(r.amount)}</td></tr>`).join("")}</tbody></table></div></details>
    <div class="card"><h3>Posted periods</h3><div class="table-wrap"><table><thead><tr><th>Period</th><th>JEV No.</th><th class="right">Items</th><th class="right">Total</th><th>Posted</th></tr></thead>
      <tbody>${[...runs].sort((a, b) => b.period.localeCompare(a.period)).map(r => `<tr><td>${esc(r.period)}</td><td>${esc(r.jevNo)}</td><td class="right">${r.count || 0}</td><td class="right">${money(r.total)}</td><td class="small">${fmtDateTime(r.postedAt)} · ${esc(r.postedBy?.name)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No depreciation posted in this fund yet.</td></tr>`}</tbody></table></div></div>`;
  $("#per", main).onchange = e => { st.dep = e.target.value; depreciation(main); };
  $("#jev", main).onclick = () => printForm(depreciationJevHtml(S.fund, period, preview, posted?.jevNo));
  $("#csv", main).onclick = () => downloadCSV(`Depreciation-${S.fund}-${period}`, ["Property No.", "Description", "Account", "Depreciation Expense", "Accumulated Depreciation", "Amount"],
    preview.rows.map(r => { const b = preview.byAccount.find(x => x.code === r.accountCode) || {}; return [r.propertyNo, r.description, r.accountCode, b.expCode, b.adCode, r.amount]; }));
  $("#pf", main) && ($("#pf", main).onsubmit = e => {
    e.preventDefault();
    busy(e.submitter, () => postDepreciation(S.fund, period, e.target.jev.value, preview), `Depreciation for ${period} posted.`).catch(() => {});
  });
  $("#un", main) && ($("#un", main).onclick = async e => {
    if (!(await confirmBox({ title: `Unpost depreciation for ${period}?`, body: "Only the latest period can be unposted.", confirmText: "Unpost", danger: true }))) return;
    busy(e.target, () => unpostDepreciation(S.fund, period), "Unposted.").catch(() => {});
  });
}
depreciation.deps = ["r:depr", "r:assets", "fund"];

/* ---------------- Trial Balance reconciliation ---------------- */
export function reconciliation(main) {
  const last = lastPosted(S.d.depr, S.fund);
  const period = st.rec && isPeriod(st.rec) ? st.rec : last || addMonths(periodOf(manilaToday()), -1);
  const tb = S.d.tb.find(t => t.fund === S.fund && t.period === period);
  const stock = {};
  for (const c of stockCards(S.d.airs, S.d.docs, S.fund, periodEnd(period))) stock[c.accountCode] = round2((stock[c.accountCode] || 0) + c.balValue);
  const rows = reconcile(S.d.assets, S.d.depr.filter(r => r.fund === S.fund), stock, tb?.accounts || null, S.fund, period, S.d.cip);
  const bad = rows.filter(r => !r.ok).length;
  // accumulated depreciation is complete up to the later of the last posted month and the imported PMS balance
  const covered = [last, ...S.d.assets.filter(a => a.fund === S.fund && a.depBaseline?.period).map(a => a.depBaseline.period)].filter(Boolean).sort().at(-1) || null;
  const deprBehind = S.d.assets.some(a => a.fund === S.fund && a.itemType === "ppe") && (!covered || covered < period);
  main.innerHTML = `<div class="page-head"><div><h1>Trial Balance Reconciliation</h1><p>Compares the register at the end of the month — PPE cost and accumulated depreciation, semi-expendable cost, Construction in Progress, supplies on hand — with the Trial Balance, account by account. Differences under ₱1 are treated as rounding.</p></div></div>
    <div class="card"><div class="table-tools" data-nodirty><div><label>As of the end of</label><input type="month" id="per" value="${period}"></div>
      <div class="grow small muted" style="align-self:center">${esc(fundName(S.fund))} · ${tb ? `Trial Balance saved ${fmtDateTime(tb.enteredAt)} by ${esc(tb.enteredBy?.name)} (${esc(tb.source)})` : "No Trial Balance saved for this month yet"}</div>
      <div class="btn-row" style="align-self:flex-end"><button class="btn" id="csv">CSV</button><button class="btn" id="pr">Print</button></div></div>
      ${deprBehind ? `<div class="notice warn">Depreciation is recorded only up to ${esc(covered || "—")}: accumulated depreciation in the register will be short of the Trial Balance until ${esc(period)} is posted.</div>` : ""}
      ${tb ? `<div class="notice ${bad ? "warn" : "ok"}">${bad ? `${bad} account${bad === 1 ? "" : "s"} to check.` : "Everything ties out."}</div>` : ""}
      <div class="table-wrap"><table><thead><tr><th>Account</th><th class="right">Cost — register</th><th class="right">Cost — TB</th><th class="right">Variance</th><th class="right">Accum. depr. — register</th><th class="right">Accum. depr. — TB</th><th class="right">Variance</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td><b>${esc(r.code)}</b> ${esc(accountName(r.code))}<div class="xs muted">${esc(CATEGORIES[r.category]?.short || "")}${r.adCode ? ` · AD ${esc(r.adCode)}` : ""}</div></td>
        <td class="right">${num(r.regCost)}</td><td class="right">${r.tbCost == null ? "—" : num(r.tbCost)}</td><td class="right">${r.varCost == null ? "—" : num(r.varCost)}</td>
        <td class="right">${r.regAD == null ? "n/a" : num(r.regAD)}</td><td class="right">${r.tbAD == null ? "n/a" : num(r.tbAD)}</td><td class="right">${r.varAD == null ? "—" : num(r.varAD)}</td>
        <td>${!tb ? `<span class="badge">No TB</span>` : r.ok ? `<span class="badge b-ok">OK</span>` : `<span class="badge b-bad">Check</span>`}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No property or supplies in this fund yet.</td></tr>`}</tbody></table></div></div>
    ${can("post") ? `<div class="card"><h3>${tb ? "Replace" : "Enter"} the Trial Balance for ${esc(period)}</h3>
      <p class="small muted">Paste from Excel (account code, account name, debit, credit — one account per line) or upload the Trial Balance file (.xlsx / .csv). Only PPE, semi-expendable and inventory accounts and their accumulated depreciation are compared.</p>
      <div class="table-tools"><div class="grow"><label>Upload</label><input type="file" id="tbf" accept=".xlsx,.xls,.csv,.txt" data-nodirty></div></div>
      <textarea id="tbt" rows="8" placeholder="10705020&#9;Office Equipment&#9;2063166.50&#9;0&#10;10705021&#9;Accumulated Depreciation - Office Equipment&#9;0&#9;756648.50"></textarea>
      <div class="btn-row end" style="margin-top:.6rem"><span class="small muted" id="cnt"></span><button class="btn primary" id="save">Save &amp; compare</button></div></div>` : ""}`;
  $("#per", main).onchange = e => { st.rec = e.target.value; reconciliation(main); };
  const headers = ["Account", "Name", "Cost — Register", "Cost — TB", "Variance", "AD Account", "AD — Register", "AD — TB", "Variance", "Status"];
  const data = () => rows.map(r => [r.code, accountName(r.code), r.regCost, r.tbCost ?? "", r.varCost ?? "", r.adCode, r.regAD ?? "", r.tbAD ?? "", r.varAD ?? "", !tb ? "No TB" : r.ok ? "OK" : "Check"]);
  $("#csv", main).onclick = () => downloadCSV(`Reconciliation-${S.fund}-${period}`, headers, data());
  $("#pr", main).onclick = () => printForm(tableReportHtml("RECONCILIATION — REGISTER VS TRIAL BALANCE", `${fundName(S.fund)} · as of ${fmtDate(periodEnd(period))}`, headers,
    data().map(r => r.map((v, i) => [2, 3, 4, 6, 7, 8].includes(i) && v !== "" ? num(v) : v))), "landscape");
  if (!can("post")) return;
  const count = () => { $("#cnt", main).textContent = `${Object.keys(parseTrialBalance($("#tbt", main).value)).length} account lines found`; };
  $("#tbt", main).oninput = count;
  $("#tbf", main).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { $("#tbt", main).value = await sheetAsText(f); $("#tbt", main).dataset.src = f.name; count(); } catch (err) { toast(err.message, "err"); }
  };
  $("#save", main).onclick = e => {
    const accounts = parseTrialBalance($("#tbt", main).value);
    busy(e.target, async () => { await saveTrialBalance(S.fund, period, accounts, $("#tbt", main).dataset.src || "Pasted"); window.dispatchEvent(new Event("app:clean")); }, "Trial Balance saved.").catch(() => {});
  };
}
reconciliation.deps = ["r:tb", "r:depr", "r:assets", "r:airs", "r:docs", "r:cip", "fund"];
