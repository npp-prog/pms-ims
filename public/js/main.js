// App entry: sign-in lifecycle, account/role, shell (TOSCAN layout), navigation and routing.
import { auth, onAuthStateChanged, signOut, getRedirectResult, authError, CONFIGURED } from "./fb.js";
import { S, startAccount, startRole, stop, onChange, can, isAdmin, role, setFund, emptyData } from "./state.js";
import { $, esc, toast, avatar, closeModals, opts } from "./ui.js";
import { FUNDS, ROLE_NAMES } from "./core/catalog.js";
import * as Auth from "./views/auth.js";
import * as Home from "./views/home.js";
import * as Air from "./views/air.js";
import * as Issue from "./views/issuance.js";
import * as Posting from "./views/posting.js";
import * as Registry from "./views/registry.js";
import * as Reports from "./views/reports.js";
import * as Admin from "./views/admin.js";
import * as Property from "./views/property.js";
import * as Accounting from "./views/accounting.js";
import * as Import from "./views/import.js";
import * as Cip from "./views/cip.js";
import * as Repairs from "./views/repairs.js";
import { counts } from "./views/common.js";

const ICON = { menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>` };
// One line icon per menu entry (24px grid, 1.8 stroke), shown before the label.
const P = {
  home: '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  "airs/new": '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>',
  airs: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  inspect: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.5 11l1.8 1.8 3.2-3.3"/>',
  issue: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  issuances: '<path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2z"/><path d="M9 8h6M9 12h6"/>',
  myproperty: '<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01"/>',
  repairs: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  "registry/ppe": '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  "registry/sx": '<path d="M4 7h16v13H4zM9 7V4h6v3"/><path d="M4 12h16"/>',
  movements: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
  "registry/stock": '<path d="M4 4h16v4H4zM5 8v12h14V8"/><path d="M10 12h4"/>',
  cip: '<path d="M2 20h20M4 20V10l8-6 8 6v10"/><path d="M9 20v-6h6v6"/><path d="M12 4V2"/>',
  swa: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  posting: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M9 9l2 2 4-4"/>',
  posted: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M8 7h8M8 11h6"/>',
  depreciation: '<path d="M3 3v18h18"/><path d="M7 8l4 4 3-3 6 6"/>',
  reconciliation: '<path d="M12 3v18M5 7h14M3 14l2-7 2 7a2 2 0 0 1-4 0zM17 14l2-7 2 7a2 2 0 0 1-4 0z"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  audit: '<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
};
const navIcon = k => `<svg class="nav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || P.home}</svg>`;
let screen = "", current = null, dirty = false, renderTimer = null, activeRole = null;

if (!CONFIGURED) Auth.renderSetupNeeded($("#app"));
else {
  getRedirectResult(auth).catch(e => setTimeout(() => toast(authError(e), "err"), 400));
  onAuthStateChanged(auth, user => {
    stop(); closeModals();
    Object.assign(S, { user, account: undefined, settings: null, d: emptyData() });
    S.ready.clear(); screen = ""; activeRole = null;
    if (!user) { screen = "login"; Auth.renderLogin($("#app")); return; }
    $("#app").innerHTML = `<div class="center-screen"><div class="loading">Loading your account…</div></div>`;
    startAccount(user.uid);
  });
}

onChange(key => {
  if (key === "account") return onAccount();
  // Offices arrive with the settings: refresh the registration form unless someone is already typing in it.
  if (key === "settings" && screen === "auth") { if (!$("#rf")?.dataset.touched) onAccount(); return; }
  if (screen !== "shell") return;
  updateChrome();
  if (key === "fund" || (current?.deps && (current.deps.includes(key) || current.deps.includes("*")))) scheduleRender();
});

function onAccount() {
  const acc = S.account;
  if (!acc || acc.status !== "active") {
    stop("r:"); activeRole = null;
    screen = "auth"; Auth.renderAccountState($("#app"), acc);
    return;
  }
  // restart the listeners when the role or the office changes (End-Users see their office's property)
  const key = `${acc.role}|${acc.office || ""}`;
  if (activeRole !== key) { activeRole = key; startRole(); screen = ""; }
  if (screen !== "shell") renderShell(); else updateChrome();
}

/* ---------------- navigation ---------------- */
function navGroups() {
  const c = counts(), r = role();
  const g = [{ items: [["home", "Dashboard"]] }];
  if (r === "enduser") {
    g.push({ label: "Acceptance & Inspection", items: [["airs/new", "New AIR"], ["airs", "Office AIRs", c.returned]] });
    g.push({ label: "My Office", items: [["issuances", "PAR / ICS / RIS"], ["myproperty", "Office Property"], ["repairs", "History of Repair", c.repairsReturned]] });
  } else {
    g.push({ label: "Acceptance & Inspection", items: [can("encodeAir") && ["airs/new", "New AIR"], can("inspectAir") && ["inspect", "For Inspection", c.inspect], ["airs", "All AIRs"]] });
    g.push({ label: "Issuance", items: [can("issue") && ["issue", "For Issuance", c.issue], ["issuances", "PAR / ICS / RIS"]] });
    g.push({ label: "Property", items: [["registry/ppe", "PPE Registry"], ["registry/sx", "Semi-Expendable Registry"], ["registry/stock", "Inventory Registry"], ["movements", "Transfers, Returns & Disposals"], ["repairs", "History of Repair", c.repairs]] });
    g.push({ label: "Construction in Progress", items: [["cip", "CIP Projects"], ["swa", "SWA"]] });
    g.push({ label: "Accounting", items: [can("post") && ["posting", "For Posting", c.post], ["posted", "Posting Status"], ["depreciation", "Depreciation"], ["reconciliation", "TB Reconciliation"], ["reports", "Reports"]] });
  }
  if (isAdmin()) g.push({ label: "Administration", items: [["users", "Users & Roles", c.pending], ["import", "Data Import"], ["settings", "Settings"], ["audit", "Audit Trail"]] });
  g.push({ items: [["profile", "My Profile"]] });
  return g.map(x => ({ ...x, items: x.items.filter(Boolean) })).filter(x => x.items.length);
}

const ROUTES = {
  home: () => Home.dashboard,
  airs: () => Air.list, airNew: () => can("encodeAir") && Air.form, air: () => Air.detail, airEdit: () => Air.form,
  inspect: () => can("inspectAir") && Air.inspectQueue,
  issue: () => can("issue") && Issue.queue, issuances: () => Issue.list, issuance: () => Issue.detail,
  posting: () => can("post") && Posting.queue, posted: () => can("viewAll") && Posting.status,
  "registry/ppe": () => can("viewAll") && Property.ppe, "registry/sx": () => can("viewAll") && Property.sx, "registry/stock": () => can("viewAll") && Registry.stock,
  asset: () => can("viewAll") && Property.detail, movements: () => can("viewAll") && Property.movements, movement: () => can("viewAll") && Property.movement,
  myproperty: () => Property.mine,
  depreciation: () => can("viewAll") && Accounting.depreciation, reconciliation: () => can("viewAll") && Accounting.reconciliation,
  import: () => isAdmin() && Import.importPage,
  cip: () => can("viewAll") && Cip.list, cipProject: () => can("viewAll") && Cip.detail, swa: () => can("viewAll") && Cip.swaList,
  repairs: () => Repairs.list, repairNew: () => Repairs.form, repair: () => Repairs.detail, repairEdit: () => Repairs.form,
  reports: () => can("viewAll") && Reports.reports,
  users: () => isAdmin() && Admin.users, settings: () => isAdmin() && Admin.settingsPage, audit: () => isAdmin() && Admin.audit,
  profile: () => Admin.profile
};

function parseHash() {
  const parts = (location.hash.replace(/^#\/?/, "") || "home").split("/").map(decodeURIComponent);
  let name = parts[0], params = parts.slice(1);
  if (name === "airs" && parts[1] === "new") { name = "airNew"; params = []; }
  else if (name === "airs" && parts[1] && parts[2] === "edit") { name = "airEdit"; params = [parts[1]]; }
  else if (name === "airs" && parts[1]) name = "air";
  else if (name === "issuances" && parts[1]) name = "issuance";
  else if (name === "assets" && parts[1]) name = "asset";
  else if (name === "movements" && parts[1]) name = "movement";
  else if (name === "cip" && parts[1]) name = "cipProject";
  else if (name === "repairs" && parts[1] === "new") { name = "repairNew"; params = [null, parts[2]]; }
  else if (name === "repairs" && parts[1] && parts[2] === "edit") { name = "repairEdit"; params = [parts[1]]; }
  else if (name === "repairs" && parts[1]) name = "repair";
  else if (name === "registry") { name = `registry/${parts[1] || "ppe"}`; params = parts.slice(2); }
  return { name, params };
}
const NAV_OF = { airNew: "airs/new", air: "airs", airEdit: "airs", issuance: "issuances", movement: "movements", asset: "registry/ppe", cipProject: "cip", repairNew: "repairs", repair: "repairs", repairEdit: "repairs" };

function renderShell() {
  screen = "shell";
  $("#app").innerHTML = `
    <header class="topbar">
      <button class="icon-btn menu-btn" id="menu-btn" aria-label="Menu">${ICON.menu}</button>
      <img class="seal" src="assets/municipal-seal.png" alt="">
      <div class="brand"><b>PMS-IMS</b><span>Property &amp; Inventory Management · Municipal Government of Candoni</span></div>
      <div class="spacer"></div>
      <a class="me" id="me" href="#/profile" title="My Profile"></a>
      <button class="icon-btn" id="logout" title="Log out">${ICON.logout}<span class="lo-txt">Log out</span></button>
    </header>
    <div class="layout"><nav class="side" aria-label="Main">
      <div class="fund"><label for="fund-sel">Fund</label><select id="fund-sel" class="fund-select" data-nodirty>${opts(FUNDS.map(f => [f.code, f.name]), S.fund)}</select></div>
      <div id="nav"></div></nav><div class="scrim" id="scrim"></div><main class="main" id="main" tabindex="-1"></main></div>`;
  $("#scrim").onclick = () => document.body.classList.remove("nav-open");
  $("#logout").onclick = async () => { if (!dirty || confirm("Leave without saving your changes?")) await signOut(auth); };
  $("#menu-btn").onclick = () => { const open = document.body.classList.toggle("nav-open"); $("#menu-btn").setAttribute("aria-expanded", String(open)); };
  $("#fund-sel").onchange = e => { if (dirty && !confirm("Switch fund and lose your unsaved changes?")) { e.target.value = S.fund; return; } dirty = false; setFund(e.target.value); };
  $("#main").addEventListener("input", e => { if (!e.target.closest("[data-nodirty]")) dirty = true; });
  updateChrome();
  route();
}

window.addEventListener("hashchange", () => { if (screen === "shell") { if (dirty && !confirm("Leave this page without saving your changes?")) return; route(); } });
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("app:clean", () => { dirty = false; $("#refresh-bar")?.remove(); });

function route() {
  const { name, params } = parseHash();
  const view = (ROUTES[name] || ROUTES.home)() || ROUTES.home();
  current = { view, params, name, deps: view.deps || ["*"] };
  dirty = false;
  closeModals();
  document.body.classList.remove("nav-open");
  updateChrome();
  renderCurrent();
  window.scrollTo(0, 0);
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (!dirty) return renderCurrent();
    if ($("#refresh-bar")) return;
    $("#main").insertAdjacentHTML("afterbegin", `<div class="notice info btn-row" id="refresh-bar" style="justify-content:space-between"><span>New information is available.</span><button class="btn sm" id="rb">Refresh (unsaved changes on this page will be lost)</button></div>`);
    $("#rb").onclick = () => { dirty = false; renderCurrent(); };
  }, 150);
}

async function renderCurrent() {
  const main = $("#main"); if (!main || !current) return;
  try { await current.view(main, current.params); }
  catch (e) { console.error(e); main.innerHTML = `<div class="notice bad">This page could not be displayed: ${esc(e.message)}</div>`; }
}

function updateChrome() {
  if (screen !== "shell") return;
  const acc = S.account || {};
  const me = $("#me"); if (me) me.innerHTML = `${avatar(acc, "sm")}<div class="who"><div>${esc(acc.displayName || acc.email || "")}</div><div class="role">${esc(ROLE_NAMES[acc.role] || "")}</div></div>`;
  const fs = $("#fund-sel"); if (fs && fs.value !== S.fund) fs.value = S.fund;
  const active = NAV_OF[current?.name] || current?.name;
  $("#nav").innerHTML = navGroups().map(g => `${g.label ? `<div class="group">${esc(g.label)}</div>` : ""}${g.items.map(([k, l, c]) =>
    `<a href="#/${k}" class="${active === k ? "active" : ""}"${active === k ? ` aria-current="page"` : ""}>${navIcon(k)}<span class="lbl">${esc(l)}</span>${c ? `<span class="count" aria-label="${c} waiting">${c}</span>` : ""}</a>`).join("")}`).join("");
}
