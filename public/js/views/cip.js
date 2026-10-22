// Construction in Progress (Accounting): projects, their billings with matched SWAs, and transfer to PPE when completed.
import { S, can, settings } from "../state.js";
import { $, $$, esc, busy, toast, money, num, fmtDate, manilaToday, opts, accountOpts, renderTable, openModal, confirmBox, downloadCSV, safeLink } from "../ui.js";
import { FUNDS, fundName, accountName, PPE_ACCOUNTS } from "../core/catalog.js";
import { CIP_ACCOUNTS, CIP_COST_FIELDS, CIP_STATUS, billingTotal, cipTotal, cipStatus, cipTransferAccount, defaultLife, residualFor } from "../core/assets.js";
import { saveCip, setCipOverride, saveBilling, deleteBilling, completeCip, saveSwa, deleteSwa } from "../data.js";
import { printForm, cipLedgerHtml } from "../print.js";

const clean = () => window.dispatchEvent(new Event("app:clean"));
const badge = st => `<span class="badge ${{ in_progress: "b-info", finished: "b-warn", completed: "b-ok" }[st]}">${esc(CIP_STATUS[st])}</span>`;
const cipAccountRows = PPE_ACCOUNTS.filter(a => CIP_ACCOUNTS.includes(a[1]));

/* ---------------- projects ---------------- */
export function list(main) {
  const rows = S.d.cip.filter(p => p.fund === S.fund);
  main.innerHTML = `<div class="page-head"><div><h1>Construction in Progress</h1><p>Projects under construction in the ${esc(fundName(S.fund))}, with every contractor billing and its SWA. A project stays in its CIP account (and in the Trial Balance comparison) until it is completed and transferred to PPE.</p></div>
    <div class="btn-row">${can("manageCip") ? `<button class="btn primary" id="new">New project</button>` : ""}<button class="btn" id="csv">CSV</button></div></div><div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "cip", rows, pageSize: 50, defaultSort: 0,
    searchText: p => `${p.cipNo} ${p.name} ${p.contractor} ${p.location}`,
    filters: [{ key: "s", label: "Status", options: Object.entries(CIP_STATUS), value: "in_progress", test: (p, v) => cipStatus(p) === v },
      { key: "a", label: "Account", options: cipAccountRows.map(a => [a[1], a[2]]), test: (p, v) => p.accountCode === v }],
    columns: [
      { label: "CIP No.", render: p => `<b>${esc(p.cipNo)}</b>`, sort: p => p.cipNo },
      { label: "Project", render: p => `${esc(p.name)}<div class="xs muted">${esc(p.contractor || "By administration")} · ${esc(p.location)}</div>`, sort: p => p.name },
      { label: "Account", render: p => `<span class="small">${esc(accountName(p.accountCode).replace("Construction in Progress - ", ""))}</span>` },
      { label: "Billings", render: p => (p.billings || []).length, cls: "right" },
      { label: "Project cost", render: p => p.projectCost ? money(p.projectCost) : "—", cls: "right", headCls: "right" },
      { label: "Billed to date", render: p => money(cipTotal(p)), sort: p => cipTotal(p), cls: "right", headCls: "right" },
      { label: "Status", render: p => badge(cipStatus(p)), sort: p => cipStatus(p) }
    ],
    empty: "No projects in this view.",
    footer: l => `<tr><td colspan="5" class="right">Total</td><td class="right">${money(l.reduce((t, p) => t + cipTotal(p), 0))}</td><td></td></tr>`,
    onRow: p => { location.hash = `#/cip/${p.id}`; }
  });
  $("#new", main) && ($("#new", main).onclick = () => projectModal(null));
  $("#csv", main).onclick = () => downloadCSV(`CIP-${S.fund}`, ["CIP No.", "Project", "Contractor", "Location", "Account", "Contract Period", "Project Cost", "Billed to Date", "Status"],
    t.rows().map(p => [p.cipNo, p.name, p.contractor, p.location, p.accountCode, p.contractPeriod, p.projectCost, cipTotal(p), CIP_STATUS[cipStatus(p)]]));
}
list.deps = ["r:cip", "fund"];

function projectModal(p) {
  const m = openModal(`<h2>${p ? "Edit project" : "New CIP project"}</h2>
    <form class="grid g2" id="pf">
      <div><label>Fund</label><select name="fund" ${p ? "disabled" : ""}>${opts(FUNDS.map(f => [f.code, f.name]), p?.fund || S.fund)}</select></div>
      <div><label class="req">Account</label><select name="accountCode">${opts(cipAccountRows.map(a => [a[1], `${a[1]} — ${a[2]}`]), p?.accountCode || CIP_ACCOUNTS[0])}</select></div>
      <div><label class="req">CIP No.</label><input name="cipNo" value="${esc(p?.cipNo || "")}" placeholder="e.g. 2026-020-06"></div>
      <div><label>Contractor <span class="muted">(blank if by administration)</span></label><input name="contractor" value="${esc(p?.contractor || "")}"></div>
      <div class="spanall"><label class="req">Name of project</label><textarea name="name">${esc(p?.name || "")}</textarea></div>
      <div><label>Location / office</label><input name="location" value="${esc(p?.location || "")}"></div>
      <div><label>Contract period</label><input name="contractPeriod" value="${esc(p?.contractPeriod || "")}" placeholder="e.g. 180 calendar days"></div>
      <div><label>Project cost (₱)</label><input type="number" step="0.01" min="0" name="projectCost" value="${esc(p?.projectCost || "")}"></div>
      <div class="spanall modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
  $("[data-x]", m).onclick = () => m.close();
  $("#pf", m).onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    if (p) v.fund = p.fund;
    if (!p && S.d.cip.some(x => x.fund === v.fund && x.cipNo === v.cipNo.trim())) return toast(`CIP No. ${v.cipNo} is already used in this fund.`, "err");
    busy(e.submitter, async () => { const id = await saveCip(p?.id, v); m.close(); location.hash = `#/cip/${id}`; }, "Project saved.").catch(() => {});
  };
}

export function detail(main, [id]) {
  const p = S.d.cip.find(x => x.id === id);
  if (!p) { main.innerHTML = `<div class="notice warn">Project not found.</div>`; return; }
  const st = cipStatus(p), open = st !== "completed", edit = can("manageCip") && open;
  let run = 0;
  const billings = (p.billings || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  main.innerHTML = `<div class="page-head"><div><h1>${esc(p.name)}</h1><p>CIP No. ${esc(p.cipNo)} · ${esc(accountName(p.accountCode))} · ${esc(fundName(p.fund))}</p></div><div class="btn-row">${badge(st)}</div></div>
    ${p.completed ? `<div class="notice ok">Transferred to PPE on ${fmtDate(p.completed.date)} — ${money(p.completed.total)} to ${esc(p.completed.accountCode)} ${esc(accountName(p.completed.accountCode))}. <a href="#/assets/${esc(p.completed.assetId)}">Open the PPE record</a></div>` : ""}
    <div class="stats"><div class="stat"><span class="n">${money(cipTotal(p))}</span><span class="l">Billed to date</span></div>
      <div class="stat"><span class="n">${p.projectCost ? money(p.projectCost) : "—"}</span><span class="l">Project cost</span></div>
      <div class="stat"><span class="n">${p.projectCost ? `${num(cipTotal(p) / p.projectCost * 100)}%` : "—"}</span><span class="l">Billed vs project cost</span></div>
      <div class="stat"><span class="n">${billings.length}</span><span class="l">Billings</span></div></div>
    <div class="card"><div class="card-head"><h3>Billings</h3><div class="btn-row">${edit ? `<button class="btn sm primary" id="addb">Add billing</button>` : ""}</div></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Ref.</th><th>Particulars</th><th class="right">By contract</th><th class="right">By administration</th><th class="right">Adjustments</th><th class="right">Running total</th><th>SWA</th></tr></thead>
      <tbody>${billings.map(b => { run += billingTotal(b); const admin = ["materials", "labor", "overhead", "consultancy", "others"].reduce((t, k) => t + (Number(b[k]) || 0), 0);
        return `<tr class="${edit ? "click" : ""}" data-b="${esc(b.id)}"><td>${fmtDate(b.date)}</td><td>${esc(b.ref)}</td><td>${esc(b.particulars)}${b.remarks ? `<div class="xs muted">${esc(b.remarks)}</div>` : ""}</td>
          <td class="right">${num(b.byContract)}</td><td class="right">${num(admin)}</td><td class="right">${Number(b.adjustments) ? num(b.adjustments) : ""}</td><td class="right"><b>${num(run)}</b></td>
          <td>${b.swaNo ? `<span class="badge b-ok">${esc(b.swaNo)}</span>` : `<span class="badge">No SWA</span>`}</td></tr>`; }).join("") || `<tr><td colspan="8" class="empty">No billings yet.</td></tr>`}</tbody></table></div></div>
    <div class="card"><h3>Details</h3><dl class="kv"><dt>Contractor</dt><dd>${esc(p.contractor || "By administration")}</dd><dt>Location</dt><dd>${esc(p.location || "—")}</dd><dt>Contract period</dt><dd>${esc(p.contractPeriod || "—")}</dd></dl>
      <div class="btn-row" style="margin-top:1rem"><button class="btn sm" id="pr">Print CIP Ledger Card</button>
        ${edit ? `<button class="btn sm" id="ed">Edit details</button>
          ${st === "in_progress" ? `<button class="btn sm" data-ov="finished">Mark construction complete</button>` : `<button class="btn sm" data-ov="in_progress">Back to in progress</button>`}
          <button class="btn sm primary" id="done">Complete → transfer to PPE</button>` : ""}</div></div>`;
  $("#pr", main).onclick = () => printForm(cipLedgerHtml(p, billingTotal), "landscape");
  if (!edit) return;
  $("#ed", main).onclick = () => projectModal(p);
  $("#addb", main).onclick = () => billingModal(p, null);
  $$("[data-b]", main).forEach(tr => tr.onclick = () => billingModal(p, p.billings.find(b => b.id === tr.dataset.b)));
  $$("[data-ov]", main).forEach(b => b.onclick = () => busy(b, () => setCipOverride(p.id, b.dataset.ov), "Status updated.").catch(() => {}));
  $("#done", main).onclick = () => completeModal(p);
}
detail.deps = ["r:cip", "r:swa"];

function billingModal(p, b) {
  const free = S.d.swa.filter(s => s.fund === p.fund && (!s.matched || s.id === b?.swaId)).sort((x, y) => (x.cipNo === p.cipNo ? -1 : 0) - (y.cipNo === p.cipNo ? -1 : 0));
  const m = openModal(`<h2>${b ? "Edit billing" : "Add billing"}</h2><p class="muted small">${esc(p.cipNo)} · ${esc(p.name)}</p>
    <form class="grid g3" id="bf">
      <div><label class="req">Transaction date</label><input type="date" name="date" value="${esc(b?.date || manilaToday())}"></div>
      <div><label>Billing / DV reference</label><input name="ref" value="${esc(b?.ref || "")}" placeholder="e.g. 1ST BILLING"></div>
      <div><label>Matched SWA</label><select name="swaId">${opts(free.map(s => [s.id, `${s.swaNo} — ${s.contractor || "—"} — ${money(s.cost)}${s.cipNo && s.cipNo !== p.cipNo ? ` (CIP ${s.cipNo})` : ""}`]), b?.swaId || "", "No SWA")}</select></div>
      <div class="spanall"><label>Particulars</label><input name="particulars" value="${esc(b?.particulars || "")}"></div>
      ${CIP_COST_FIELDS.map(([k, l]) => `<div><label>${esc(l)} (₱)</label><input type="number" step="0.01" name="${k}" value="${esc(b?.[k] || "")}"></div>`).join("")}
      <div class="span2"><label>Remarks</label><input name="remarks" value="${esc(b?.remarks || "")}" placeholder="Write FINAL on the last billing"></div>
      <div class="spanall small muted" id="tot"></div>
      <div class="spanall modal-actions">${b ? `<button type="button" class="btn danger" id="del" style="margin-right:auto">Delete</button>` : ""}<button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">Save billing</button></div></form>`, { size: "wide" });
  const f = $("#bf", m);
  const tot = () => { $("#tot", m).textContent = `This billing: ${money(billingTotal(Object.fromEntries(new FormData(f).entries())))}`; };
  f.addEventListener("input", tot); tot();
  $("[data-x]", m).onclick = () => m.close();
  f.onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    busy(e.submitter, async () => { await saveBilling(p.id, b?.id, v, v.swaId); m.close(); clean(); }, "Billing saved.").catch(() => {});
  };
  $("#del", m) && ($("#del", m).onclick = async () => {
    if (!(await confirmBox({ title: "Delete this billing?", body: "Its SWA is released so it can be matched again.", confirmText: "Delete", danger: true }))) return;
    busy(null, () => deleteBilling(p.id, b.id), "Billing deleted.").then(() => m.close()).catch(() => {});
  });
}

function completeModal(p) {
  const total = cipTotal(p), code = cipTransferAccount(p.accountCode);
  const m = openModal(`<h2>Complete → transfer to PPE</h2><p class="muted small">${esc(p.name)} — the ${money(total)} billed to date becomes a new PPE record and this project closes. This can't be undone here.</p>
    <form class="grid g2" id="cf">
      <div class="spanall"><label class="req">PPE account</label><select name="accountCode">${accountOpts(PPE_ACCOUNTS.filter(a => a[3]), code)}</select></div>
      <div><label class="req">Date completed</label><input type="date" name="date" value="${manilaToday()}"></div>
      <div><label>Property No.</label><input name="propertyNo"></div>
      <div><label>Useful life (years)</label><input type="number" min="0" step="1" name="life" value="${defaultLife(code)}"></div>
      <div><label>Residual value (₱)</label><input type="number" min="0" step="0.01" name="residual" value="${residualFor(code, total)}"></div>
      <div><label>Location / office</label><input name="location" value="${esc(p.location || "")}"></div>
      <div><label>Accountable officer</label><input name="holder" value="${esc(settings().signatories.propertyCustodian || "")}"></div>
      <div class="spanall modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">Transfer ${money(total)} to PPE</button></div></form>`);
  const f = $("#cf", m);
  f.accountCode.onchange = () => { f.life.value = defaultLife(f.accountCode.value); f.residual.value = residualFor(f.accountCode.value, total); };
  $("[data-x]", m).onclick = () => m.close();
  f.onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    busy(e.submitter, async () => { const aid = await completeCip(p.id, v); m.close(); location.hash = `#/assets/${aid}`; }, "Transferred to PPE.").catch(() => {});
  };
}

/* ---------------- SWA ---------------- */
export function swaList(main) {
  const rows = S.d.swa.filter(s => s.fund === S.fund);
  main.innerHTML = `<div class="page-head"><div><h1>Statements of Work Accomplished</h1><p>SWAs in the ${esc(fundName(S.fund))}. Accounting matches each SWA to the CIP billing it supports; a matched SWA is locked until the billing releases it.</p></div>
    <div class="btn-row">${can("encodeSwa") ? `<button class="btn primary" id="new">New SWA</button>` : ""}<button class="btn" id="csv">CSV</button></div></div><div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "swa", rows, pageSize: 50, defaultSort: 0, defaultDir: -1,
    searchText: s => `${s.swaNo} ${s.cipNo} ${s.contractor}`,
    filters: [{ key: "m", label: "Matched", options: [["y", "Matched"], ["n", "Not matched"]], test: (s, v) => !!s.matched === (v === "y") }],
    columns: [
      { label: "Date", render: s => fmtDate(s.date), sort: s => s.date },
      { label: "SWA No.", render: s => `<b>${esc(s.swaNo)}</b>`, sort: s => s.swaNo },
      { label: "CIP No.", render: s => esc(s.cipNo || "—") },
      { label: "Contractor", render: s => esc(s.contractor || "—") },
      { label: "% done", render: s => s.percent == null ? "—" : `${num(s.percent)}%`, cls: "right" },
      { label: "Cost", render: s => money(s.cost), sort: s => s.cost, cls: "right", headCls: "right" },
      { label: "Document", render: s => safeLink(s.docLink) ? `<a href="${esc(safeLink(s.docLink))}" target="_blank" rel="noopener">Open</a>` : "—" },
      { label: "Status", render: s => s.matched ? `<a class="badge b-ok" href="#/cip/${esc(s.matchedProjectId)}">Matched</a>` : `<span class="badge b-warn">Not matched</span>` }
    ],
    empty: "No SWAs yet.",
    onRow: s => can("encodeSwa") && !s.matched ? swaModal(s) : s.matched ? (location.hash = `#/cip/${s.matchedProjectId}`) : null
  });
  $("#new", main) && ($("#new", main).onclick = () => swaModal(null));
  $("#csv", main).onclick = () => downloadCSV(`SWA-${S.fund}`, ["Date", "SWA No.", "CIP No.", "Contractor", "Percent", "Cost", "Matched", "Document"], t.rows().map(s => [s.date, s.swaNo, s.cipNo, s.contractor, s.percent ?? "", s.cost, s.matched ? "Yes" : "No", s.docLink]));
}
swaList.deps = ["r:swa", "fund"];

function swaModal(s) {
  const cips = S.d.cip.filter(p => p.fund === (s?.fund || S.fund) && p.status !== "completed");
  const m = openModal(`<h2>${s ? "Edit SWA" : "New Statement of Work Accomplished"}</h2>
    <form class="grid g2" id="sf">
      <div><label>Fund</label><select name="fund" ${s ? "disabled" : ""}>${opts(FUNDS.map(f => [f.code, f.name]), s?.fund || S.fund)}</select></div>
      <div><label class="req">Transaction date</label><input type="date" name="date" value="${esc(s?.date || manilaToday())}"></div>
      <div><label class="req">SWA No.</label><input name="swaNo" value="${esc(s?.swaNo || "")}"></div>
      <div><label>CIP No.</label><input name="cipNo" list="cipl" value="${esc(s?.cipNo || "")}"><datalist id="cipl">${cips.map(p => `<option value="${esc(p.cipNo)}">${esc(p.name)}</option>`).join("")}</datalist></div>
      <div><label>Contractor</label><input name="contractor" value="${esc(s?.contractor || "")}"></div>
      <div><label>Cost (₱)</label><input type="number" step="0.01" min="0" name="cost" value="${esc(s?.cost ?? "")}"></div>
      <div><label>Accomplishment (%)</label><input type="number" step="0.01" min="0" max="100" name="percent" value="${esc(s?.percent ?? "")}"></div>
      <div><label>Link to the scanned SWA</label><input name="docLink" value="${esc(s?.docLink || "")}" placeholder="https://drive.google.com/…"></div>
      <div class="spanall"><label>Remarks</label><input name="remarks" value="${esc(s?.remarks || "")}"></div>
      <div class="spanall modal-actions">${s ? `<button type="button" class="btn danger" id="del" style="margin-right:auto">Delete</button>` : ""}<button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
  $("[data-x]", m).onclick = () => m.close();
  $("#sf", m).onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    if (s) v.fund = s.fund;
    if (S.d.swa.some(x => x.fund === v.fund && x.swaNo === v.swaNo.trim() && x.id !== s?.id)) return toast(`SWA No. ${v.swaNo} is already used in this fund.`, "err");
    busy(e.submitter, async () => { await saveSwa(s?.id, v); m.close(); }, "SWA saved.").catch(() => {});
  };
  $("#del", m) && ($("#del", m).onclick = async () => {
    if (!(await confirmBox({ title: `Delete SWA ${s.swaNo}?`, confirmText: "Delete", danger: true }))) return;
    busy(null, () => deleteSwa(s.id), "SWA deleted.").then(() => m.close()).catch(() => {});
  });
}
