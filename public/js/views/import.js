// Administration → Data Import: brings over the existing PMS property register and IMS supplies on hand.
import { S, settings } from "../state.js";
import { $, $$, esc, busy, toast, money, num, qty, opts, readRows, downloadCSV } from "../ui.js";
import { FUNDS, fundName, accountName } from "../core/catalog.js";
import { normalizeAssets, normalizeStock, normalizeCip, isPeriod, cipTotal } from "../core/assets.js";
import { importAssets, importStock, importCip } from "../data.js";

const st = { tab: "assets", fund: "GF", baseline: "2025-12", asOf: "", parsed: null, file: "" };

export function importPage(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Data Import</h1><p>One-time transfer of your existing records into this system. Nothing is saved until you review the preview and click Import.</p></div></div>
    <div class="tabs">${[["assets", "Property from PMS"], ["cip", "CIP from PMS"], ["stock", "Supplies from IMS"]].map(([k, l]) => `<button data-t="${k}" class="${st.tab === k ? "active" : ""}">${l}</button>`).join("")}</div>
    <div class="card" data-nodirty>
      ${st.tab === "assets" ? `<p class="small">Use the <b>PMS Asset Register → Export CSV</b> file (one per fund, or one with a Fund column), the PMS <code>data/seed_assets.json</code> file, or the template. PPE and semi-expendable items are recognised by their account. Items marked <i>retired</i> come in as disposed, so they stay in the history but not in the totals.</p>
        <p class="small"><b>Accumulated depreciation:</b> the "Accum. Depr." column is taken as the balance at the end of the month below, normally the <b>last month posted in PMS</b>. Depreciation here continues from the following month. Post nothing in PMS after you export.</p>`
      : st.tab === "cip" ? `<p class="small">Use the file you load into PMS with <b>Bulk import CIP billings</b> (one billing per row: account_code, cip_code, project_name, location, contractor, date, ref, by_contract, admin_materials, admin_labor, admin_overhead, admin_consultancy, admin_others, transfers_adjustments, remarks — with that header row), or the PMS <b>CIP Projects → Export CSV</b> file, which brings each project's total billed to date as one "balance brought forward" billing. Projects PMS shows as <i>Transferred</i> are skipped — they are already in the property register.</p>`
      : `<p class="small">Use the <b>IMS Inventory Registry → Download CSV</b> file (with Balance Qty and Unit Cost) or the template. Each fund's supplies on hand come in as one already-posted <b>beginning-balance AIR</b>, so the GSO issues them with a RIS like any delivery, and the Stock Cards start from these balances.</p>`}
      <div class="table-tools">
        <div><label>Fund (when the file has no Fund column)</label><select id="fund">${opts(FUNDS.map(f => [f.code, f.name]), st.fund)}</select></div>
        ${st.tab === "assets" ? `<div><label>Accumulated depreciation as of</label><input type="month" id="bp" value="${esc(st.baseline)}"></div>`
          : `<div><label>${st.tab === "cip" ? "Date for brought-forward totals" : "Balances as of (date)"}</label><input type="date" id="asof" value="${esc(st.asOf)}"></div>`}
        <div class="grow"><label>File (.csv, .xlsx${st.tab === "assets" ? ", .json" : ""})</label><input type="file" id="file" accept=".csv,.xlsx,.xls${st.tab === "assets" ? ",.json" : ""}"></div>
        <div style="align-self:flex-end"><button class="btn" id="tpl">Download template</button></div>
      </div>
      <div id="out"></div>
    </div>`;
  $$(".tabs [data-t]", main).forEach(b => b.onclick = () => { st.tab = b.dataset.t; st.parsed = null; importPage(main); });
  $("#fund", main).onchange = e => { st.fund = e.target.value; reparse(main); };
  $("#bp", main) && ($("#bp", main).onchange = e => { st.baseline = e.target.value; reparse(main); });
  $("#asof", main) && ($("#asof", main).onchange = e => { st.asOf = e.target.value; st.tab === "cip" ? reparse(main) : draw(main); });
  $("#tpl", main).onclick = () => st.tab === "cip"
    ? downloadCSV("PMS-CIP-import-template", ["account_code", "cip_code", "project_name", "location", "contractor", "date", "ref", "by_contract", "admin_materials", "admin_labor", "admin_overhead", "admin_consultancy", "admin_others", "transfers_adjustments", "remarks"],
      [["10710030", "2026-020-01", "Construction of Multi-Purpose Building", "Brgy. East", "ABC Builders", "2026-03-15", "1ST BILLING", "1200000", "", "", "", "", "", "", ""]])
    : st.tab === "assets"
    ? downloadCSV("PMS-import-template", ["Fund", "Type", "Property ID", "Account Code", "Description", "Location", "Accountable Officer", "Date Acquired", "Cost", "Residual Value", "Useful Life (yrs)", "Accum. Depr.", "Status"],
      [["GF", "PPE", "2026-001", "10705030", "Desktop computer", "Accounting Office", "Juan Dela Cruz", "2024-03-15", "65000", "3250", "5", "11375", "active"]])
    : downloadCSV("IMS-import-template", ["Fund", "Account Code", "Stock No.", "Description", "Unit", "Balance Qty", "Unit Cost"], [["GF", "10404010", "OS-0001", "Bond paper, A4", "ream", "40", "250"]]);
  $("#file", main).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { st.raw = await readRows(f); st.file = f.name; reparse(main); }
    catch (err) { toast(`Couldn't read ${f.name}: ${err.message}`, "err"); }
  };
  draw(main);
}
importPage.deps = [];

function reparse(main) {
  if (!st.raw) return draw(main);
  if (st.tab === "assets" && !isPeriod(st.baseline)) { toast("Choose the month of the accumulated depreciation.", "err"); return; }
  if (st.tab === "cip" && !st.asOf) { toast("Enter the date for brought-forward totals first.", "err"); return; }
  st.parsed = st.tab === "assets" ? normalizeAssets(st.raw, { fund: st.fund, baselinePeriod: st.baseline, offices: settings().offices })
    : st.tab === "cip" ? normalizeCip(st.raw, { fund: st.fund, asOf: st.asOf }) : normalizeStock(st.raw, { fund: st.fund });
  draw(main);
}

function draw(main) {
  const out = $("#out", main);
  if (!st.parsed) { out.innerHTML = ""; return; }
  const { items, errors } = st.parsed;
  if (st.tab === "cip") {
    const { projects, skipped } = st.parsed;
    const have = new Set(S.d.cip.map(p => `${p.fund}|${p.cipNo}`));
    const fresh = projects.filter(p => !have.has(`${p.fund}|${p.cipNo}`)), dup = projects.length - fresh.length;
    out.innerHTML = `<div class="stats"><div class="stat"><span class="n">${fresh.length}</span><span class="l">projects to import</span></div>
        <div class="stat"><span class="n">${fresh.reduce((t, p) => t + p.billings.length, 0)}</span><span class="l">billings</span></div>
        <div class="stat"><span class="n">${money(fresh.reduce((t, p) => t + cipTotal(p), 0))}</span><span class="l">billed to date</span></div>
        <div class="stat"><span class="n">${skipped}</span><span class="l">already transferred (skipped)</span></div>
        <div class="stat ${errors.length ? "alert" : ""}"><span class="n">${errors.length}</span><span class="l">rows with problems</span></div>
        <div class="stat"><span class="n">${dup}</span><span class="l">already here (skipped)</span></div></div>
      ${problems(errors)}
      <div class="table-wrap"><table><thead><tr><th>Fund</th><th>CIP No.</th><th>Project</th><th>Account</th><th>Contractor</th><th class="right">Billings</th><th class="right">Billed to date</th></tr></thead>
        <tbody>${fresh.map(p => `<tr><td>${esc(p.fund)}</td><td>${esc(p.cipNo)}</td><td>${esc(p.name)}</td><td class="small">${esc(p.accountCode)}</td><td>${esc(p.contractor)}</td><td class="right">${p.billings.length}</td><td class="right">${num(cipTotal(p))}</td></tr>`).join("")}</tbody></table></div>
      <div class="btn-row end" style="margin-top:1rem"><button class="btn primary" id="go" ${fresh.length ? "" : "disabled"}>Import ${fresh.length} projects</button></div>`;
    $("#go", out).onclick = e => busy(e.target, async () => { await importCip(fresh); st.parsed = null; st.raw = null; importPage(main); }, `${fresh.length} CIP projects imported.`).catch(() => {});
    return;
  }
  if (st.tab === "assets") {
    const have = new Set(S.d.assets.filter(a => a.propertyNo).map(a => `${a.fund}|${a.propertyNo}`));
    const dup = items.filter(i => i.propertyNo && have.has(`${i.fund}|${i.propertyNo}`));
    const fresh = items.filter(i => !dup.includes(i));
    const haveCip = new Set(S.d.cip.map(p => `${p.fund}|${p.cipNo}`));
    const cipFresh = (st.parsed.cip || []).filter(p => !haveCip.has(`${p.fund}|${p.cipNo}`));
    const sum = k => money(fresh.filter(k).reduce((t, i) => t + i.cost, 0));
    out.innerHTML = `<div class="stats"><div class="stat"><span class="n">${fresh.length}</span><span class="l">to import from ${esc(st.file)}</span></div>
        <div class="stat"><span class="n">${sum(i => i.itemType === "ppe" && i.status === "active")}</span><span class="l">PPE in use (cost)</span></div>
        <div class="stat"><span class="n">${sum(i => i.itemType === "sx" && i.status === "active")}</span><span class="l">Semi-expendable in use (cost)</span></div>
        <div class="stat"><span class="n">${fresh.filter(i => i.status === "disposed").length}</span><span class="l">retired / disposed</span></div>
        <div class="stat ${errors.length ? "alert" : ""}"><span class="n">${errors.length}</span><span class="l">rows with problems (skipped)</span></div>
        <div class="stat"><span class="n">${dup.length}</span><span class="l">already here (skipped)</span></div></div>
      ${cipFresh.length ? `<div class="notice info">${cipFresh.length} item${cipFresh.length === 1 ? " is" : "s are"} on a Construction in Progress account (${money(cipFresh.reduce((t, p) => t + cipTotal(p), 0))}). ${cipFresh.length === 1 ? "It" : "They"} will be created as <b>CIP projects</b> with the cost brought forward, not as PPE.</div>` : ""}
      ${problems(errors)}
      <div class="table-wrap"><table><thead><tr><th>Fund</th><th>Type</th><th>Property No.</th><th>Description</th><th>Account</th><th>Acquired</th><th class="right">Cost</th><th class="right">Accum. depr.</th><th class="right">Life</th><th>Officer / office</th><th>Status</th></tr></thead>
        <tbody>${fresh.slice(0, 100).map(i => `<tr><td>${esc(i.fund)}</td><td>${i.itemType === "ppe" ? "PPE" : "SX"}</td><td>${esc(i.propertyNo)}</td><td>${esc(i.description)}</td><td class="small">${esc(i.accountCode)} ${esc(accountName(i.accountCode))}</td>
          <td>${esc(i.dateAcquired)}</td><td class="right">${num(i.cost)}</td><td class="right">${i.depBaseline ? num(i.depBaseline.amount) : "—"}</td><td class="right">${i.usefulLifeYears || "—"}</td><td>${esc(i.holder.name)}<div class="xs muted">${esc(i.holder.office || "office not recognised")}</div></td><td>${esc(i.status)}</td></tr>`).join("")}</tbody></table></div>
      ${fresh.length > 100 ? `<p class="small muted">Showing the first 100 of ${fresh.length}.</p>` : ""}
      <div class="btn-row end" style="margin-top:1rem"><span class="small muted" id="prog"></span><button class="btn primary" id="go" ${fresh.length || cipFresh.length ? "" : "disabled"}>Import ${fresh.length} records${cipFresh.length ? ` and ${cipFresh.length} CIP projects` : ""}</button></div>`;
    $("#go", out).onclick = e => busy(e.target, async () => {
      if (fresh.length) await importAssets(fresh, (d, t) => { const p = $("#prog", out); if (p) p.textContent = `${d} of ${t} saved…`; });
      if (cipFresh.length) await importCip(cipFresh);
      st.parsed = null; st.raw = null; importPage(main);
    }, `${fresh.length} property records imported${cipFresh.length ? ` and ${cipFresh.length} CIP projects` : ""}.`).catch(() => {});
  } else {
    const funds = [...new Set(items.map(i => i.fund))];
    const already = funds.filter(f => S.d.airs.some(a => a.imported && a.fund === f));
    out.innerHTML = `<div class="stats"><div class="stat"><span class="n">${items.length}</span><span class="l">stock numbers with a balance</span></div>
        <div class="stat"><span class="n">${money(items.reduce((t, i) => t + i.qty * i.unitCost, 0))}</span><span class="l">value on hand</span></div>
        <div class="stat ${errors.length ? "alert" : ""}"><span class="n">${errors.length}</span><span class="l">rows with problems (skipped)</span></div></div>
      ${already.length ? `<div class="notice warn">A beginning balance was already imported for ${esc(already.map(fundName).join(", "))}. Importing again would count those supplies twice.</div>` : ""}
      ${problems(errors)}
      <div class="table-wrap"><table><thead><tr><th>Fund</th><th>Stock No.</th><th>Description</th><th>Account</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Value</th></tr></thead>
        <tbody>${items.slice(0, 100).map(i => `<tr><td>${esc(i.fund)}</td><td>${esc(i.stockNo)}</td><td>${esc(i.description)}</td><td class="small">${esc(i.accountCode)}</td><td class="right">${qty(i.qty)} ${esc(i.unit)}</td><td class="right">${num(i.unitCost)}</td><td class="right">${num(i.qty * i.unitCost)}</td></tr>`).join("")}</tbody></table></div>
      <div class="btn-row end" style="margin-top:1rem"><button class="btn primary" id="go" ${items.length && !already.length ? "" : "disabled"}>Import ${items.length} balances</button></div>`;
    $("#go", out).onclick = e => {
      if (!st.asOf) return toast("Enter the date the balances are as of.", "err");
      busy(e.target, async () => { await importStock(items, st.asOf); st.parsed = null; st.raw = null; importPage(main); }, "Supplies on hand imported.").catch(() => {});
    };
  }
}

const problems = errors => errors.length ? `<details class="notice warn"><summary>${errors.length} row${errors.length === 1 ? "" : "s"} can't be imported — show</summary>
  <ul class="small">${errors.slice(0, 200).map(e => `<li>Row ${e.line}${e.description ? ` (${esc(e.description)})` : ""}: ${esc(e.problem)}</li>`).join("")}</ul></details>` : "";
