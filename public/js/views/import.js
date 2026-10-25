// Administration → Data Import: brings over the existing PMS property register and IMS supplies on hand.
import { S, settings, isSuper } from "../state.js";
import { $, $$, esc, busy, toast, money, num, qty, opts, readRows, downloadCSV } from "../ui.js";
import { FUNDS, fundName, accountName } from "../core/catalog.js";
import { normalizeAssets, normalizeStock, normalizeCip, normalizeParIcs, isPeriod, cipTotal } from "../core/assets.js";
import { importAssets, importStock, importCip, importParIcs, importUsers, deleteInvite } from "../data.js";
import { parsePmsUsers, IMPORT_ROLES } from "../core/users.js";
import { ROLE_NAMES } from "../core/catalog.js";

const st = { tab: "assets", fund: "GF", baseline: "2025-12", asOf: "", parsed: null, file: "" };

export function importPage(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Data Import</h1><p>One-time transfer of your existing records into this system. Nothing is saved until you review the preview and click Import.</p></div></div>
    <div class="tabs">${[["assets", "Property from PMS"], ["parics", "Pending PAR / ICS from PMS"], ["cip", "CIP from PMS"], ["stock", "Supplies from IMS"], ["users", "Users from PMS"]].map(([k, l]) => `<button data-t="${k}" class="${st.tab === k ? "active" : ""}">${l}</button>`).join("")}</div>
    ${st.tab === "users" ? `<div id="users"></div>` : `<div class="card" data-nodirty>
      ${st.tab === "assets" ? `<p class="small">Use the <b>PMS Asset Register → Export CSV</b> file (one per fund, or one with a Fund column), the PMS <code>data/seed_assets.json</code> file, or the template. PPE and semi-expendable items are recognised by their account. Items marked <i>retired</i> come in as disposed, so they stay in the history but not in the totals.</p>
        <p class="small"><b>Accumulated depreciation:</b> the "Accum. Depr." column is taken as the balance at the end of the month below, normally the <b>last month posted in PMS</b>. Depreciation here continues from the following month. Post nothing in PMS after you export.</p>`
      : st.tab === "parics" ? `<p class="small">Brings over the PAR and ICS that PMS still shows as <b>Pending</b> (issued, not yet recorded in its Asset Register). Use the PMS daily backup <code>firestore-export.json</code> — it has everything, including who received the property — or the PMS <b>PAR / ICS → Download CSV</b> file (set the status filter to Pending or All), or the template. PAR / ICS shown as <i>Recorded</i> in PMS are skipped: their items come in with the property register.</p>
        <p class="small">Each one keeps its PMS number and comes in as an issued PAR / ICS waiting for Accounting. Its item enters the registry when Accounting posts it on <b>For Posting</b>, like any PAR / ICS issued here.</p>`
      : st.tab === "cip" ? `<p class="small">Use the file you load into PMS with <b>Bulk import CIP billings</b> (one billing per row: account_code, cip_code, project_name, location, contractor, date, ref, by_contract, admin_materials, admin_labor, admin_overhead, admin_consultancy, admin_others, transfers_adjustments, remarks — with that header row), or the PMS <b>CIP Projects → Export CSV</b> file, which brings each project's total billed to date as one "balance brought forward" billing. Projects PMS shows as <i>Transferred</i> are skipped — they are already in the property register.</p>`
      : `<p class="small">Use the <b>IMS Inventory Registry → Download CSV</b> file (with Balance Qty and Unit Cost) or the template. Each fund's supplies on hand come in as one already-posted <b>beginning-balance AIR</b>, so the GSO issues them with a RIS like any delivery, and the Stock Cards start from these balances.</p>`}
      <div class="table-tools">
        <div><label>Fund (when the file has no Fund column)</label><select id="fund">${opts(FUNDS.map(f => [f.code, f.name]), st.fund)}</select></div>
        ${st.tab === "parics" ? "" : st.tab === "assets" ? `<div><label>Accumulated depreciation as of</label><input type="month" id="bp" value="${esc(st.baseline)}"></div>`
          : `<div><label>${st.tab === "cip" ? "Date for brought-forward totals" : "Balances as of (date)"}</label><input type="date" id="asof" value="${esc(st.asOf)}"></div>`}
        <div class="grow"><label>File (.csv, .xlsx${["assets", "parics"].includes(st.tab) ? ", .json" : ""})</label><input type="file" id="file" accept=".csv,.xlsx,.xls${["assets", "parics"].includes(st.tab) ? ",.json" : ""}"></div>
        <div style="align-self:flex-end"><button class="btn" id="tpl">Download template</button></div>
      </div>
      <div id="out"></div>
    </div>`}`;
  $$(".tabs [data-t]", main).forEach(b => b.onclick = () => { st.tab = b.dataset.t; st.parsed = null; importPage(main); });
  if (st.tab === "users") return usersImport($("#users", main));
  $("#fund", main).onchange = e => { st.fund = e.target.value; reparse(main); };
  $("#bp", main) && ($("#bp", main).onchange = e => { st.baseline = e.target.value; reparse(main); });
  $("#asof", main) && ($("#asof", main).onchange = e => { st.asOf = e.target.value; st.tab === "cip" ? reparse(main) : draw(main); });
  $("#tpl", main).onclick = () => st.tab === "parics"
    ? downloadCSV("PMS-PAR-ICS-import-template", ["Fund", "Type", "Number", "Date Issued", "Account Code", "Description", "Qty", "Unit", "Amount", "Property No./SEN", "Dept/Office or Entity", "Received by", "Position", "Status"],
      [["GF", "PAR", "2026-10-0007", "2026-10-15", "10705030", "Desktop computer", "1", "unit", "65000", "PPE-2026-0101", "Municipal Accounting Office", "Juan Dela Cruz", "Accounting Clerk", "Pending"],
        ["GF", "ICS", "SPLV-2026-10-0003", "2026-10-15", "10405020", "Office chair", "2", "pc", "7000", "", "Municipal Accounting Office", "Juan Dela Cruz", "Accounting Clerk", "Pending"]])
    : st.tab === "cip"
    ? downloadCSV("PMS-CIP-import-template", ["account_code", "cip_code", "project_name", "location", "contractor", "date", "ref", "by_contract", "admin_materials", "admin_labor", "admin_overhead", "admin_consultancy", "admin_others", "transfers_adjustments", "remarks"],
      [["10710030", "2026-020-01", "Construction of Multi-Purpose Building", "Brgy. East", "ABC Builders", "2026-03-15", "1ST BILLING", "1200000", "", "", "", "", "", "", ""]])
    : st.tab === "assets"
    ? downloadCSV("PMS-import-template", ["Fund", "Type", "Property ID", "Account Code", "Description", "Location", "Accountable Officer", "Date Acquired", "Cost", "Residual Value", "Useful Life (yrs)", "Accum. Depr.", "Status"],
      [["GF", "PPE", "2026-001", "10705030", "Desktop computer", "Accounting Office", "Juan Dela Cruz", "2024-03-15", "65000", "3250", "5", "11375", "active"]])
    : downloadCSV("IMS-import-template", ["Fund", "Account Code", "Stock No.", "Description", "Unit", "Balance Qty", "Unit Cost"], [["GF", "10404010", "OS-0001", "Bond paper, A4", "ream", "40", "250"]]);
  $("#file", main).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      // the PMS backup holds every collection: take its par_ics list
      if (st.tab === "parics" && /\.json$/i.test(f.name)) { const d = JSON.parse(await f.text()); st.raw = Array.isArray(d) ? d : d.par_ics || []; }
      else st.raw = await readRows(f);
      st.file = f.name; reparse(main);
    }
    catch (err) { toast(`Couldn't read ${f.name}: ${err.message}`, "err"); }
  };
  draw(main);
}
importPage.deps = ["r:users", "r:invites"];

function reparse(main) {
  if (!st.raw) return draw(main);
  if (st.tab === "assets" && !isPeriod(st.baseline)) { toast("Choose the month of the accumulated depreciation.", "err"); return; }
  if (st.tab === "cip" && !st.asOf) { toast("Enter the date for brought-forward totals first.", "err"); return; }
  st.parsed = st.tab === "parics" ? normalizeParIcs(st.raw, { fund: st.fund, offices: settings().offices, thresholds: settings().thresholds })
    : st.tab === "assets" ? normalizeAssets(st.raw, { fund: st.fund, baselinePeriod: st.baseline, offices: settings().offices })
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
  if (st.tab === "parics") {
    const { docs, recorded } = st.parsed;
    const key = d => `${d.fund}|${d.docType}|${String(d.number).toLowerCase()}`;
    const have = new Set(S.d.docs.map(key)), haveIds = new Set(S.d.docs.map(d => d.legacy?.pmsId).filter(Boolean));
    const dup = docs.filter(d => have.has(key(d)) || (d.pmsId && haveIds.has(d.pmsId)));
    const fresh = docs.filter(d => !dup.includes(d)), noName = fresh.filter(d => d.noName).length;
    const sum = t => money(fresh.filter(d => d.docType === t).reduce((x, d) => x + d.amount, 0));
    out.innerHTML = `<div class="stats"><div class="stat"><span class="n">${fresh.length}</span><span class="l">pending PAR / ICS to import</span></div>
        <div class="stat"><span class="n">${sum("par")}</span><span class="l">PAR (PPE)</span></div>
        <div class="stat"><span class="n">${sum("ics")}</span><span class="l">ICS (semi-expendable)</span></div>
        <div class="stat"><span class="n">${recorded}</span><span class="l">recorded in PMS (skipped)</span></div>
        <div class="stat ${errors.length ? "alert" : ""}"><span class="n">${errors.length}</span><span class="l">rows with problems (skipped)</span></div>
        <div class="stat"><span class="n">${dup.length}</span><span class="l">already here (skipped)</span></div></div>
      ${noName ? `<div class="notice warn">${noName} of these ${noName === 1 ? "has" : "have"} no "Received by" name in the file (the PMS CSV doesn't include it), so the office is shown as the recipient. The PMS backup file has the names.</div>` : ""}
      ${problems(errors)}
      <div class="table-wrap"><table><thead><tr><th>Fund</th><th>Type</th><th>Number</th><th>Date</th><th>Description</th><th>Account</th><th class="right">Qty</th><th class="right">Amount</th><th>Received by / office</th></tr></thead>
        <tbody>${fresh.slice(0, 100).map(d => `<tr><td>${esc(d.fund)}</td><td>${d.docType.toUpperCase()}</td><td>${esc(d.number)}</td><td>${esc(d.date)}</td><td>${esc(d.description)}${d.propertyNo ? `<div class="xs muted">${esc(d.propertyNo)}</div>` : ""}</td>
          <td class="small">${esc(d.accountCode)} ${esc(accountName(d.accountCode))}</td><td class="right">${qty(d.qty)} ${esc(d.unit)}</td><td class="right">${num(d.amount)}</td><td>${esc(d.recipient.name)}<div class="xs muted">${esc(d.recipient.office)}</div></td></tr>`).join("")}</tbody></table></div>
      ${fresh.length > 100 ? `<p class="small muted">Showing the first 100 of ${fresh.length}.</p>` : ""}
      <div class="btn-row end" style="margin-top:1rem"><span class="small muted" id="prog"></span><button class="btn primary" id="go" ${fresh.length ? "" : "disabled"}>Import ${fresh.length} PAR / ICS</button></div>`;
    $("#go", out).onclick = e => busy(e.target, async () => {
      await importParIcs(fresh, (d, t) => { const p = $("#prog", out); if (p) p.textContent = `${d} of ${t} saved…`; });
      st.parsed = null; st.raw = null; importPage(main);
    }, `${fresh.length} PAR / ICS imported — waiting for Accounting on For Posting.`).catch(() => {});
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

/* ---------------- users from PMS ---------------- */
const us = { rows: null, sources: [] };
function usersImport(el) {
  const offices = settings().offices, roles = IMPORT_ROLES.filter(r => r !== "admin" || isSuper());
  const known = new Map(S.d.users.map(u => [String(u.email).toLowerCase(), u]));
  const invited = new Map(S.d.invites.map(i => [i.email, i]));
  const state = r => { const u = known.get(r.email); return u ? (u.status === "active" ? ["Already active here", "b-ok"] : ["Registered here — will be approved", "b-info"]) : invited.has(r.email) ? (invited.get(r.email).acceptedUid ? ["Signed in already", "b-ok"] : ["Invited — will be updated", "b-gold"]) : ["New — invited", ""]; };
  el.innerHTML = `<div class="card" data-nodirty>
      <p class="small">Brings the people who use PMS into PMS-IMS with a role and an office. Load any of these (several at once is fine — they are merged by email):</p>
      <ul class="small" style="margin-top:0">
        <li><b>The PMS backup</b> <code>firestore-export.json</code> (the PMS daily backup — it holds <code>user_roles</code>: who is approved, Admin, and which tabs each person can edit).</li>
        <li><b>The PMS sign-in accounts</b>, exported by the Firebase project owner with <code>firebase auth:export pms-users.json --project mgo-candoni-ppe</code> — this also includes PMS email/password accounts that have no role record.</li>
        <li>Or paste one person per line: <code>email, name, role, office, position</code> (role: enduser, gso, accounting${isSuper() ? ", admin" : ""}).</li></ul>
      <p class="small">Each person gets an <b>invitation</b>: when they first sign in here with that email (Google, or email and password once their email is confirmed), their account opens straight away with the role and office you set — no approval wait. Someone who already registered here is approved immediately. Nobody gets the Super Administrator role this way.</p>
      <div class="table-tools"><div class="grow"><label>Files (.json, .csv, .txt)</label><input type="file" id="uf" multiple accept=".json,.csv,.txt"></div></div>
      <div><label>Or paste</label><textarea id="up" rows="3" placeholder="juan.delacruz@gmail.com, Juan Dela Cruz, accounting, Municipal Accounting Office, Accounting Clerk"></textarea></div>
      <div class="btn-row" style="margin-top:.6rem"><button class="btn" id="ur">Read</button></div>
      <div id="uout" style="margin-top:1rem"></div></div>
    <div class="card"><div class="card-head"><h3>Invitations</h3><span class="small muted">${S.d.invites.length}</span></div>
      ${S.d.invites.length ? `<div class="table-wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Office</th><th>Status</th><th></th></tr></thead><tbody>
        ${S.d.invites.slice().sort((a, b) => a.email.localeCompare(b.email)).map(i => `<tr><td>${esc(i.email)}</td><td>${esc(i.displayName || "—")}</td><td>${esc(ROLE_NAMES[i.role] || i.role)}</td><td>${esc(i.office || "—")}</td>
          <td>${i.acceptedUid ? `<span class="badge b-ok">Signed in</span>` : `<span class="badge b-warn">Not signed in yet</span>`}</td><td>${i.acceptedUid ? "" : `<button class="btn sm danger" data-del="${esc(i.email)}">Remove</button>`}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="muted small">No invitations yet.</p>`}</div>`;
  const draw = () => {
    const out = $("#uout", el);
    if (!us.rows) { out.innerHTML = ""; return; }
    if (us.errors?.length) { out.innerHTML = `<div class="notice warn">${us.errors.map(esc).join("<br>")}</div>`; if (!us.rows.length) return; }
    const n = us.rows.filter(r => r.include).length;
    out.innerHTML = `${us.errors?.length ? out.innerHTML : ""}
      <div class="stats"><div class="stat"><span class="n">${us.rows.length}</span><span class="l">people found</span></div><div class="stat"><span class="n">${n}</span><span class="l">to bring over</span></div>
        <div class="stat"><span class="n">${us.rows.filter(r => r.include && !r.office).length}</span><span class="l">without an office yet</span></div></div>
      <p class="small muted">Check each person's role and office. Suggested roles come from their PMS access: PMS Admin → Admin${isSuper() ? "" : " (only the Super Administrator can give the Admin role, so these are set to Accounting)"}; edit rights on the register, depreciation, reconciliation or CIP → Accounting; on PAR / ICS or PTR / ITR only → GSO; view-only → End-User.</p>
      <div class="table-wrap"><table class="lines"><thead><tr><th><input type="checkbox" id="uall" ${n === us.rows.length ? "checked" : ""}></th><th>Email</th><th>Name</th><th>In PMS</th><th>Role here</th><th>Office</th><th>Position</th><th>Here</th></tr></thead>
      <tbody>${us.rows.map((r, i) => { const [t, c] = state(r); return `<tr data-i="${i}"><td><input type="checkbox" data-k="include" ${r.include ? "checked" : ""}></td><td>${esc(r.email)}</td>
        <td><input data-k="name" value="${esc(r.name)}" class="w-md"></td><td class="xs">${esc(r.pmsAccess || "—")}${r.note ? `<div class="muted">${esc(r.note)}</div>` : ""}</td>
        <td><select data-k="role" class="w-md">${opts(roles.map(x => [x, ROLE_NAMES[x]]), r.role)}</select></td>
        <td><select data-k="office" class="w-lg">${opts(r.office && !offices.includes(r.office) ? [r.office, ...offices] : offices, r.office, "Choose office")}</select></td>
        <td><input data-k="position" value="${esc(r.position || "")}" class="w-md"></td><td><span class="badge ${c}">${esc(t)}</span></td></tr>`; }).join("")}</tbody></table></div>
      <div class="btn-row end" style="margin-top:.8rem"><button class="btn primary" id="ugo" ${n ? "" : "disabled"}>Bring over ${n} ${n === 1 ? "person" : "people"}</button></div>`;
    $("#uall", out).onchange = e => { us.rows.forEach(r => { r.include = e.target.checked; }); draw(); };
    out.querySelector("tbody").addEventListener("change", e => {
      const tr = e.target.closest("tr[data-i]"), k = e.target.dataset.k; if (!tr || !k) return;
      const r = us.rows[+tr.dataset.i]; r[k] = k === "include" ? e.target.checked : e.target.value;
      if (k === "include") draw();
    });
    $("#ugo", out).onclick = e => {
      const rows = us.rows.filter(r => r.include);
      const noOffice = rows.filter(r => !r.office && r.role === "enduser");
      if (noOffice.length) return toast(`Choose the office of ${noOffice.length} End-User(s) — it decides which property they see.`, "err");
      busy(e.target, async () => {
        const res = await importUsers(rows.filter(r => !(known.get(r.email)?.status === "active")));
        us.rows = null; us.sources = [];
        toast(`${res.invited} invited, ${res.activated} approved${res.skipped ? `, ${res.skipped} already active` : ""}.`, "ok");
      }).catch(() => {});
    };
  };
  $("#uf", el).onchange = async e => { us.sources = await Promise.all([...e.target.files].map(f => f.text())); };
  $("#ur", el).onclick = () => {
    const parsed = parsePmsUsers([...us.sources, $("#up", el).value]);
    if (!isSuper()) parsed.users.forEach(r => { if (r.role === "admin") r.role = "accounting"; });
    us.rows = parsed.users; us.errors = parsed.errors; draw();
  };
  el.addEventListener("click", async e => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    busy(b, () => deleteInvite(b.dataset.del), "Invitation removed.").catch(() => {});
  });
  draw();
}
