// Dashboard — same layout as the TOSCAN Portal home: greeting, "Needs your attention" inbox,
// "At a glance" figures and recent activity, with the content chosen by role.
import { S, role, can, isAdmin, fundAirs, fundDocs, fundAssets } from "../state.js";
import { $, esc, manilaToday, money, fmtDate, fmtDateTime, avatar, airBadge, docStatusBadge } from "../ui.js";
import { fundName, ROLE_NAMES, ppeAccount, accountName } from "../core/catalog.js";
import { searchAll } from "../core/cards.js";
import { counts, postingItems } from "./common.js";
import { stockCards } from "../core/logic.js";
import { lastPosted, addMonths, periodOf, accumAsOf, impairmentAsOf, isDepreciable, cipTotal, cipStatus, reconcile, costGate } from "../core/assets.js";
import { round2 } from "../core/logic.js";

const I = {
  doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M8 7h8M8 11h6"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>`
};
function greeting() {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Manila" }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
const row = (icon, cls, title, sub, n, href) => `<li><a href="${esc(href)}"><span class="ic ${cls}">${icon}</span><span class="t"><b>${esc(title)}</b><span>${esc(sub)}</span></span><span class="n">${n}</span></a></li>`;
const yearOf = d => String(d || "").slice(0, 4);

export function dashboard(main) {
  const c = counts(), r = role(), year = new Date().getFullYear().toString();
  const airs = fundAirs(), docs = fundDocs().filter(d => d.status !== "cancelled");
  const mine = S.d.airs.filter(a => a.endUserUid === S.user.uid);
  const posting = can("post") || can("viewAll") ? postingItems() : [];
  const oldestInspect = airs.filter(a => a.status === "submitted").sort((a, b) => (a.submittedAt?.seconds || 0) - (b.submittedAt?.seconds || 0))[0];

  const items = [
    isAdmin() && c.pending && row(I.user, "red", "Registrations to approve", "New accounts waiting for a role", c.pending, "#/users"),
    c.returned && row(I.back, "red", "AIRs returned to you", "Correct and resubmit to the GSO", c.returned, "#/airs"),
    c.drafts && row(I.doc, "", "Draft AIRs", "Not yet submitted to the GSO", c.drafts, "#/airs"),
    c.repairsReturned && row(I.back, "red", "Repairs returned to you", "Correct the repair record and send it again", c.repairsReturned, "#/repairs"),
    c.repairs && row(I.check, "blue", "Repairs to verify", "History of Repair records sent by End-Users", c.repairs, "#/repairs"),
    c.inspect && row(I.check, "blue", "AIRs for inspection", oldestInspect ? `Oldest: AIR ${oldestInspect.airNo} from ${oldestInspect.office}` : "", c.inspect, "#/inspect"),
    c.issue && row(I.box, "", "AIRs for issuance", "Issue PAR, ICS or RIS for the approved items", c.issue, "#/issue"),
    deprDue() && row(I.book, "", "Depreciation to post", deprDue(), "1", "#/depreciation"),
    c.post && row(I.book, "green", "For posting", "AIRs with their PAR / ICS / RIS, and disposals, not yet posted in the registry", c.post, "#/posting")
  ].filter(Boolean);

  const glance = r === "enduser" ? [
    ["My AIRs submitted", mine.filter(a => a.status !== "draft").length, "#/airs"],
    ["Office AIRs (all encoders)", S.d.airs.filter(a => a.status !== "draft").length, "#/airs"],
    ["Waiting for GSO inspection", mine.filter(a => a.status === "submitted").length, "#/airs"],
    ["Approved, for issuance", mine.filter(a => a.status === "approved").length, "#/airs"],
    ["PAR / ICS / RIS issued to my AIRs", S.d.docs.filter(d => d.status !== "cancelled").length, "#/issuances"]
  ] : [
    [`AIRs encoded, ${year}`, airs.filter(a => a.status !== "draft" && yearOf(a.date) === year).length, "#/airs"],
    [`Value received, ${year}`, money(airs.filter(a => ["approved", "issued"].includes(a.status) && yearOf(a.date) === year).reduce((t, a) => t + (a.total || 0), 0)), "#/airs"],
    ["PPE on hand — carrying amount", money(onHand("ppe").reduce((t, a) => t + a.cost - accumAsOf(a, periodOf(manilaToday()), S.d.depr), 0)), "#/registry/ppe"],
    ["Semi-expendable on hand — cost", money(onHand("sx").reduce((t, a) => t + a.cost, 0)), "#/registry/sx"],
    ["Supplies on hand", money(stockCards(S.d.airs, S.d.docs, S.fund).reduce((t, x) => t + x.balValue, 0)), "#/registry/stock"],
    ["Posted in the registry", `${posting.filter(p => p.posting.posted).length} of ${posting.length}`, "#/posted"]
  ];

  const recentAirs = (r === "enduser" ? S.d.airs : airs).filter(a => a.status !== "draft").sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)).slice(0, 6);
  const recentDocs = [...(r === "enduser" ? S.d.docs : docs)].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 6);
  const name = (S.account?.displayName || "").split(" ")[0];

  main.innerHTML = `
    <div class="home-head">${avatar(S.account, "lg")}<div><h1>${greeting()}${name ? `, ${esc(name)}` : ""}</h1>
      <p>${esc(ROLE_NAMES[r] || "")}${S.account?.office ? ` · ${esc(S.account.office)}` : ""} · ${esc(fundName(S.fund))}</p></div></div>
    ${can("viewAll") ? `<div class="card search-card" data-nodirty><input type="search" id="gs" placeholder="Search everything: property no., item, officer, PAR / ICS / RIS, PTR, job order, AIR, CIP…" value="${esc(srch.q)}" autocomplete="off"><div id="gsr" class="search-hits"></div></div>` : ""}
    <div class="steps">${flowSteps(r)}</div>
    ${can("viewAll") ? overview() : ""}
    <div class="home">
      <div>
        <div class="card"><div class="card-head"><h3>Needs your attention</h3><span class="small muted">${items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : ""}</span></div>
          <ul class="inbox">${items.join("") || `<li><span class="ic green">${I.check}</span><span class="t"><b>You're all caught up</b><span>Nothing is waiting for you in ${esc(fundName(S.fund))}.</span></span></li>`}</ul></div>
        <div class="card"><div class="card-head"><h3>Recent AIRs</h3><a class="btn sm" href="#/airs">Open list</a></div>
          ${recentAirs.length ? `<div class="table-wrap"><table><tbody>${recentAirs.map(a => `<tr class="click" onclick="location.hash='#/airs/${a.id}'"><td><b>${esc(a.airNo || "Draft")}</b><div class="xs muted">${esc(a.office)}</div></td><td class="small">${esc(a.supplier)}</td><td class="right">${money(a.total)}</td><td>${airBadge(a.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No AIRs yet.</div>`}</div>
      </div>
      <div>
        <div class="card"><div class="card-head"><h3>At a glance</h3><span class="small muted">${esc(fmtDate(new Date()))}</span></div>
          <ul class="glance">${glance.map(([l, v, h]) => `<li><a href="${h}"><span>${esc(l)}</span></a><b>${esc(v)}</b></li>`).join("")}</ul></div>
        <div class="card"><div class="card-head"><h3>Recently issued</h3></div>
          <ul class="upcoming">${recentDocs.map(d => `<li><span class="when">${fmtDateTime(d.createdAt)}</span><a href="#/issuances/${d.id}">${esc(d.docType.toUpperCase())} ${esc(d.number)}</a> — ${esc(d.recipient?.name || "")} ${docStatusBadge(d)}</li>`).join("") || `<li class="muted">Nothing issued yet.</li>`}</ul></div>
      </div>
    </div>`;
  const gs = $("#gs", main);
  if (gs) {
    const show = () => { srch.q = gs.value; $("#gsr", main).innerHTML = hits(searchAll(gs.value, S.d, S.fund)); };
    gs.addEventListener("input", show);
    if (srch.q) { show(); if (srch.focus) { gs.focus(); gs.setSelectionRange(gs.value.length, gs.value.length); } }
    gs.addEventListener("focus", () => { srch.focus = true; }); gs.addEventListener("blur", () => { srch.focus = false; });
  }
}
dashboard.deps = ["*"];

const srch = { q: "", focus: false };
function hits(r) {
  if (!r) return "";
  const grp = (title, list, fn) => list.length ? `<h4>${esc(title)} <span class="xs muted">${list.length}</span></h4>${list.map(fn).join("")}` : "";
  const html = grp("Property", r.assets, a => `<a href="#/assets/${esc(a.id)}"><b>${esc(a.propertyNo || "—")}</b> ${esc(a.description)} <span class="xs muted">${esc(a.holder?.name || "")} · ${esc(a.status)}</span></a>`)
    + grp("PAR / ICS / RIS", r.docs, d => `<a href="#/issuances/${esc(d.id)}"><b>${esc(d.docType.toUpperCase())} ${esc(d.number)}</b> ${esc(d.recipient?.name || "")} <span class="xs muted">${esc(d.recipient?.office || "")} · ${money(d.total)}</span></a>`)
    + grp("Transfers, returns and disposals", r.movements, x => `<a href="#/movements/${esc(x.id)}"><b>${esc(x.docType.toUpperCase())} ${esc(x.number)}</b> ${esc(x.from?.name || "")} → ${esc(x.to?.name || x.mode || "")}</a>`)
    + grp("Repairs", r.repairs, x => `<a href="#/repairs/${esc(x.id)}"><b>JO ${esc(x.jobOrderNo)}</b> ${esc(x.description || "")} <span class="xs muted">${money(x.totalCost)}</span></a>`)
    + grp("AIRs", r.airs, a => `<a href="#/airs/${esc(a.id)}"><b>AIR ${esc(a.airNo)}</b> ${esc(a.supplier)} <span class="xs muted">${esc(a.office)}</span></a>`)
    + grp("Construction in Progress", r.cip, p => `<a href="#/cip/${esc(p.id)}"><b>CIP ${esc(p.cipNo)}</b> ${esc(p.name)}</a>`);
  return html || `<p class="muted small" style="margin:.6rem 0 0">Nothing found in ${esc(fundName(S.fund))}.</p>`;
}

/** Property overview (PMS dashboard): balances, depreciation and reconciliation status, CIP waiting for transfer, and PPE by group. */
function overview() {
  const per = periodOf(manilaToday()), runs = S.d.depr;
  const assets = fundAssets().filter(a => ["active", "returned"].includes(a.status));
  const ppe = assets.filter(a => a.itemType === "ppe"), sx = assets.filter(a => a.itemType === "sx");
  const ad = a => accumAsOf(a, per, runs) + impairmentAsOf(a, per);
  const ppeCost = round2(ppe.reduce((t, a) => t + a.cost, 0)), ppeCarry = round2(ppe.reduce((t, a) => t + a.cost - ad(a), 0));
  const cip = S.d.cip.filter(p => p.fund === S.fund && p.status !== "completed");
  const awaiting = cip.filter(p => cipStatus(p) === "finished");
  const last = lastPosted(runs, S.fund);
  const tb = S.d.tb.filter(t => t.fund === S.fund).sort((a, b) => b.period.localeCompare(a.period))[0];
  const rec = tb ? reconcile(S.d.assets, runs, {}, tb.accounts, S.fund, tb.period, S.d.cip).filter(r => ppeAccount(r.code) && (r.regCost || r.tbCost)) : [];
  const flagged = rec.filter(r => !r.ok).length;
  const next = last ? addMonths(last, 1) : null, gate = next && next < per ? costGate(S.d.assets, runs, S.d.tb, S.fund, next, S.d.cip) : null;
  const byGroup = new Map();
  for (const a of ppe) { const g = ppeAccount(a.accountCode)?.group || accountName(a.accountCode) || "Other"; const e = byGroup.get(g) || { g, n: 0, cost: 0, carry: 0 }; e.n++; e.cost += a.cost; e.carry += a.cost - ad(a); byGroup.set(g, e); }
  return `<div class="card"><div class="card-head"><h3>Property overview</h3><span class="small muted">${esc(fundName(S.fund))} · as of ${fmtDate(manilaToday())}</span></div>
    <div class="stats">
      <div class="stat"><span class="n">${money(ppeCost)}</span><span class="l">PPE cost (${ppe.length})</span></div>
      <div class="stat"><span class="n">${money(ppeCarry)}</span><span class="l">PPE carrying amount</span></div>
      <div class="stat"><span class="n">${money(sx.reduce((t, a) => t + a.cost, 0))}</span><span class="l">Semi-expendable (${sx.length})</span></div>
      <div class="stat"><span class="n">${money(cip.reduce((t, p) => t + cipTotal(p), 0))}</span><span class="l">Construction in progress (${cip.length})</span></div></div>
    <ul class="glance">
      <li><a href="#/depreciation"><span>Depreciation</span></a><b>${last ? `posted to ${esc(last)}` : "none posted yet"}${gate && !gate.ok ? " · on hold (Trial Balance)" : ""}</b></li>
      <li><a href="#/reconciliation"><span>Reconciliation</span></a><b>${tb ? `${esc(tb.period)}: ${flagged ? `${flagged} account(s) to check` : "PPE ties out"}` : "no Trial Balance yet"}</b></li>
      <li><a href="#/cip"><span>CIP ready to transfer to PPE</span></a><b>${awaiting.length}</b></li>
    </ul>
    ${byGroup.size ? `<div class="table-wrap" style="margin-top:.6rem"><table><thead><tr><th>PPE group</th><th class="right">Items</th><th class="right">Cost</th><th class="right">Carrying amount</th></tr></thead>
      <tbody>${[...byGroup.values()].sort((a, b) => b.cost - a.cost).map(e => `<tr><td>${esc(e.g)}</td><td class="right">${e.n}</td><td class="right">${money(e.cost)}</td><td class="right">${money(e.carry)}</td></tr>`).join("")}</tbody></table></div>` : ""}
  </div>`;
}

const onHand = type => fundAssets().filter(a => a.itemType === type && ["active", "returned"].includes(a.status));
/** For Accounting: the month that should be posted next, if it is already over. */
function deprDue() {
  if (!can("post") || !fundAssets().some(isDepreciable)) return "";
  const prev = addMonths(periodOf(manilaToday()), -1), last = lastPosted(S.d.depr, S.fund);
  if (!last) return `No depreciation posted yet in this fund — start with ${prev}`;
  return last < prev ? `${addMonths(last, 1)} is not yet posted` : "";
}

function flowSteps(r) {
  const st = [["End-User", "Encodes the AIR"], ["GSO", "Inspects & approves"], ["GSO", "Issues PAR / ICS / RIS"], ["Accounting", "Posts in the registry"]];
  const mineIdx = { enduser: 0, gso: 1, accounting: 3 }[r];
  return st.map(([w, t], i) => `<div class="${i === mineIdx || (r === "gso" && i === 2) ? "now" : ""}"><b>${i + 1}. ${esc(t)}</b>${esc(w)}</div>`).join("");
}

