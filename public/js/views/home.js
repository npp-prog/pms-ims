// Dashboard — same layout as the TOSCAN Portal home: greeting, "Needs your attention" inbox,
// "At a glance" figures and recent activity, with the content chosen by role.
import { S, role, can, isAdmin, fundAirs, fundDocs } from "../state.js";
import { esc, money, fmtDate, fmtDateTime, avatar, airBadge, docStatusBadge } from "../ui.js";
import { fundName, ROLE_NAMES } from "../core/catalog.js";
import { counts, postingItems } from "./common.js";
import { stockCards } from "../core/logic.js";

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
    c.inspect && row(I.check, "blue", "AIRs for inspection", oldestInspect ? `Oldest: AIR ${oldestInspect.airNo} from ${oldestInspect.office}` : "", c.inspect, "#/inspect"),
    c.issue && row(I.box, "", "AIRs for issuance", "Issue PAR, ICS or RIS for the approved items", c.issue, "#/issue"),
    c.post && row(I.book, "green", "Documents for posting", "PAR / ICS / RIS and supply receipts not yet posted in the registry", c.post, "#/posting")
  ].filter(Boolean);

  const glance = r === "enduser" ? [
    ["My AIRs submitted", mine.filter(a => a.status !== "draft").length, "#/airs"],
    ["Waiting for GSO inspection", mine.filter(a => a.status === "submitted").length, "#/airs"],
    ["Approved, for issuance", mine.filter(a => a.status === "approved").length, "#/airs"],
    ["PAR / ICS / RIS issued to my AIRs", S.d.docs.filter(d => d.status !== "cancelled").length, "#/issuances"]
  ] : [
    [`AIRs encoded, ${year}`, airs.filter(a => a.status !== "draft" && yearOf(a.date) === year).length, "#/airs"],
    [`Value received, ${year}`, money(airs.filter(a => ["approved", "issued"].includes(a.status) && yearOf(a.date) === year).reduce((t, a) => t + (a.total || 0), 0)), "#/airs"],
    ["PPE issued (PAR)", money(docs.filter(d => d.docType === "par").reduce((t, d) => t + d.total, 0)), "#/registry/ppe"],
    ["Semi-expendable issued (ICS)", money(docs.filter(d => d.docType === "ics").reduce((t, d) => t + d.total, 0)), "#/registry/sx"],
    ["Supplies on hand", money(stockCards(S.d.airs, S.d.docs, S.fund).reduce((t, x) => t + x.balValue, 0)), "#/registry/stock"],
    ["Posted in the registry", `${posting.filter(p => p.posting.posted).length} of ${posting.length}`, "#/posted"]
  ];

  const recentAirs = (r === "enduser" ? mine : airs).filter(a => a.status !== "draft").sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)).slice(0, 6);
  const recentDocs = [...(r === "enduser" ? S.d.docs : docs)].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 6);
  const name = (S.account?.displayName || "").split(" ")[0];

  main.innerHTML = `
    <div class="home-head">${avatar(S.account, "lg")}<div><h1>${greeting()}${name ? `, ${esc(name)}` : ""}</h1>
      <p>${esc(ROLE_NAMES[r] || "")}${S.account?.office ? ` · ${esc(S.account.office)}` : ""} · ${esc(fundName(S.fund))}</p></div></div>
    <div class="steps">${flowSteps(r)}</div>
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
}
dashboard.deps = ["*"];

function flowSteps(r) {
  const st = [["End-User", "Encodes the AIR"], ["GSO", "Inspects & approves"], ["GSO", "Issues PAR / ICS / RIS"], ["Accounting", "Posts in the registry"]];
  const mineIdx = { enduser: 0, gso: 1, accounting: 3 }[r];
  return st.map(([w, t], i) => `<div class="${i === mineIdx || (r === "gso" && i === 2) ? "now" : ""}"><b>${i + 1}. ${esc(t)}</b>${esc(w)}</div>`).join("");
}

