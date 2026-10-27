// Dashboard: greeting, KPI cards, "Needs your attention" inbox and recent activity, with the content chosen by role.
import { S, role, can, isAdmin, fundAirs, fundDocs, fundAssets } from "../state.js";
import { $, esc, manilaToday, money, fmtDateTime, avatar, airBadge, docStatusBadge } from "../ui.js";
import { fundName, ROLE_NAMES } from "../core/catalog.js";
import { searchAll } from "../core/cards.js";
import { counts, postingItems } from "./common.js";
import { stockCards } from "../core/logic.js";
import { lastPosted, addMonths, periodOf, accumAsOf, isDepreciable } from "../core/assets.js";

const I = {
  doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M8 7h8M8 11h6"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>`,
  peso: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21V3h6a5 5 0 0 1 0 10H7"/><path d="M4 7h16M4 10h16"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/></svg>`,
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
    c.repairs && row(I.check, "blue", "Repairs waiting for the GSO", "Pre- and post-repair inspections, and posted repairs to verify", c.repairs, "#/repairs"),
    c.inspect && row(I.check, "blue", "AIRs for inspection", oldestInspect ? `Oldest: from ${oldestInspect.office}, ${oldestInspect.supplier}` : "", c.inspect, "#/inspect"),
    c.issue && row(I.box, "", "AIRs for issuance", "Issue PAR, ICS or RIS for the approved items", c.issue, "#/issue"),
    deprDue() && row(I.book, "", "Depreciation to post", deprDue(), "1", "#/depreciation"),
    c.post && row(I.book, "green", "For posting", "AIRs with their PAR / ICS / RIS, and disposals, not yet posted in the registry", c.post, "#/posting")
  ].filter(Boolean);

  // KPI cards: [label, figure, hint, link, icon]
  const glance = r === "enduser" ? [
    ["My AIRs submitted", mine.filter(a => a.status !== "draft").length, "Encoded by you", "#/airs", I.doc],
    ["Office AIRs", S.d.airs.filter(a => a.status !== "draft").length, "All encoders in your office", "#/airs", I.doc],
    ["Waiting for inspection", mine.filter(a => a.status === "submitted").length, "With the GSO", "#/airs", I.check],
    ["Approved, for issuance", mine.filter(a => a.status === "approved").length, "PAR / ICS / RIS to follow", "#/airs", I.box],
    ["PAR / ICS / RIS issued", S.d.docs.filter(d => d.status !== "cancelled").length, "To your office", "#/issuances", I.book]
  ] : [
    ["AIRs encoded", airs.filter(a => a.status !== "draft" && yearOf(a.date) === year).length, `In ${year}`, "#/airs", I.doc],
    ["Value received", money(airs.filter(a => ["approved", "issued"].includes(a.status) && yearOf(a.date) === year).reduce((t, a) => t + (a.total || 0), 0)), `Approved AIRs, ${year}`, "#/airs", I.peso],
    ["PPE on hand", money(onHand("ppe").reduce((t, a) => t + a.cost - accumAsOf(a, periodOf(manilaToday()), S.d.depr), 0)), "Carrying amount", "#/registry/ppe", I.chart],
    ["Semi-expendable on hand", money(onHand("sx").reduce((t, a) => t + a.cost, 0)), "At cost", "#/registry/sx", I.box],
    ["Supplies on hand", money(stockCards(S.d.airs, S.d.docs, S.fund).reduce((t, x) => t + x.balValue, 0)), "Inventory Registry balance", "#/registry/stock", I.box],
    ["Posted in the registry", `${posting.filter(p => p.posting.posted).length} of ${posting.length}`, "AIRs and documents", "#/posted", I.book]
  ];

  const recentAirs = (r === "enduser" ? S.d.airs : airs).filter(a => a.status !== "draft").sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)).slice(0, 6);
  const recentDocs = [...(r === "enduser" ? S.d.docs : docs)].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 6);
  const name = (S.account?.displayName || "").split(" ")[0];

  main.innerHTML = `
    <div class="home-head">${avatar(S.account, "lg")}<div><h1>${greeting()}${name ? `, ${esc(name)}` : ""}</h1>
      <p>${esc(ROLE_NAMES[r] || "")}${S.account?.office ? ` · ${esc(S.account.office)}` : ""} · ${esc(fundName(S.fund))}</p></div></div>
    <div class="kpis">${glance.map(([l, v, h, href, ic]) => `<a class="kpi" href="${href}"><span class="top">${esc(l)}${ic}</span><span class="v">${esc(v)}</span><span class="h">${esc(h)}</span></a>`).join("")}</div>
    ${can("viewAll") ? `<div class="card search-card" data-nodirty><input type="search" id="gs" placeholder="Search everything: property no., item, officer, PAR / ICS / RIS, PTR, job order, AIR, CIP…" value="${esc(srch.q)}" autocomplete="off"><div id="gsr" class="search-hits"></div></div>` : ""}
    <div class="steps">${flowSteps(r)}</div>
    <div class="home">
      <div>
        <div class="card"><div class="card-head"><h3>Needs your attention</h3><span class="small muted">${items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : ""}</span></div>
          <ul class="inbox">${items.join("") || `<li><span class="ic green">${I.check}</span><span class="t"><b>You're all caught up</b><span>Nothing is waiting for you in ${esc(fundName(S.fund))}.</span></span></li>`}</ul></div>
        <div class="card"><div class="card-head"><h3>Recent AIRs</h3><a class="btn sm" href="#/airs">Open list</a></div>
          ${recentAirs.length ? `<div class="table-wrap"><table><tbody>${recentAirs.map(a => `<tr class="click" onclick="location.hash='#/airs/${a.id}'"><td><b>${esc(a.airNo || (a.status === "draft" ? "Draft" : "For inspection"))}</b><div class="xs muted">${esc(a.office)}</div></td><td class="small">${esc(a.supplier)}</td><td class="right">${money(a.total)}</td><td>${airBadge(a.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No AIRs yet.</div>`}</div>
      </div>
      <div>
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
    + grp("Repairs", r.repairs, x => `<a href="#/repairs/${esc(x.id)}"><b>${x.jobOrderNo ? `JO ${esc(x.jobOrderNo)}` : "Repair request"}</b> ${esc(x.description || "")} <span class="xs muted">${money(x.totalCost)}</span></a>`)
    + grp("AIRs", r.airs, a => `<a href="#/airs/${esc(a.id)}"><b>AIR ${esc(a.airNo)}</b> ${esc(a.supplier)} <span class="xs muted">${esc(a.office)}</span></a>`)
    + grp("Construction in Progress", r.cip, p => `<a href="#/cip/${esc(p.id)}"><b>CIP ${esc(p.cipNo)}</b> ${esc(p.name)}</a>`);
  return html || `<p class="muted small" style="margin:.6rem 0 0">Nothing found in ${esc(fundName(S.fund))}.</p>`;
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

