// App entry: sign-in lifecycle, account/role, shell (TOSCAN layout), navigation and routing.
import { auth, onAuthStateChanged, signOut, getRedirectResult, authError, CONFIGURED } from "./fb.js";
import { S, startAccount, startRole, stop, onChange, can, isAdmin, role, setFund } from "./state.js";
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
import { counts } from "./views/common.js";

const ICON = { menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>` };
let screen = "", current = null, dirty = false, renderTimer = null, activeRole = null;

if (!CONFIGURED) Auth.renderSetupNeeded($("#app"));
else {
  getRedirectResult(auth).catch(e => setTimeout(() => toast(authError(e), "err"), 400));
  onAuthStateChanged(auth, user => {
    stop(); closeModals();
    Object.assign(S, { user, account: undefined, settings: null, d: { airs: [], docs: [], users: [], audit: [] } });
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
  if (activeRole !== acc.role) { activeRole = acc.role; startRole(); screen = ""; }
  if (screen !== "shell") renderShell(); else updateChrome();
}

/* ---------------- navigation ---------------- */
function navGroups() {
  const c = counts(), r = role();
  const g = [{ items: [["home", "Dashboard"]] }];
  if (r === "enduser") {
    g.push({ label: "Acceptance & Inspection", items: [["airs/new", "New AIR"], ["airs", "My AIRs", c.returned]] });
    g.push({ label: "Issued to Me", items: [["issuances", "PAR / ICS / RIS"]] });
  } else {
    g.push({ label: "Acceptance & Inspection", items: [can("encodeAir") && ["airs/new", "New AIR"], can("inspectAir") && ["inspect", "For Inspection", c.inspect], ["airs", "All AIRs"]] });
    g.push({ label: "Issuance", items: [can("issue") && ["issue", "For Issuance", c.issue], ["issuances", "PAR / ICS / RIS"]] });
    g.push({ label: "Accounting", items: [can("post") && ["posting", "For Posting", c.post], ["posted", "Posting Status"]] });
    g.push({ label: "Registries", items: [["registry/ppe", "Property (PPE)"], ["registry/sx", "Semi-Expendable"], ["registry/stock", "Supplies Stock Cards"], ["reports", "Reports"]] });
  }
  if (isAdmin()) g.push({ label: "Administration", items: [["users", "Users & Roles", c.pending], ["settings", "Settings"], ["audit", "Audit Trail"]] });
  g.push({ items: [["profile", "My Profile"]] });
  return g.map(x => ({ ...x, items: x.items.filter(Boolean) })).filter(x => x.items.length);
}

const ROUTES = {
  home: () => Home.dashboard,
  airs: () => Air.list, airNew: () => can("encodeAir") && Air.form, air: () => Air.detail, airEdit: () => Air.form,
  inspect: () => can("inspectAir") && Air.inspectQueue,
  issue: () => can("issue") && Issue.queue, issuances: () => Issue.list, issuance: () => Issue.detail,
  posting: () => can("post") && Posting.queue, posted: () => can("viewAll") && Posting.status,
  "registry/ppe": () => can("viewAll") && Registry.ppe, "registry/sx": () => can("viewAll") && Registry.sx, "registry/stock": () => can("viewAll") && Registry.stock,
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
  else if (name === "registry") { name = `registry/${parts[1] || "ppe"}`; params = parts.slice(2); }
  return { name, params };
}
const NAV_OF = { airNew: "airs/new", air: "airs", airEdit: "airs", issuance: "issuances" };

function renderShell() {
  screen = "shell";
  $("#app").innerHTML = `
    <header class="topbar">
      <button class="icon-btn menu-btn" id="menu-btn" aria-label="Menu">${ICON.menu}</button>
      <img class="seal" src="assets/municipal-seal.png" alt="">
      <div class="brand"><b>PMS-IMS</b><span>Property &amp; Inventory Management · Municipal Government of Candoni</span></div>
      <div class="spacer"></div>
      <div class="me" id="me"></div>
      <button class="icon-btn" id="logout">Log out</button>
    </header>
    <div class="layout"><nav class="side" aria-label="Main">
      <div class="fund"><label for="fund-sel">Fund</label><select id="fund-sel" class="fund-select" data-nodirty>${opts(FUNDS.map(f => [f.code, f.name]), S.fund)}</select></div>
      <div id="nav"></div></nav><main class="main" id="main" tabindex="-1"></main></div>`;
  $("#logout").onclick = async () => { if (!dirty || confirm("Leave without saving your changes?")) await signOut(auth); };
  $("#menu-btn").onclick = () => document.body.classList.toggle("nav-open");
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
    `<a href="#/${k}" class="${active === k ? "active" : ""}">${esc(l)}${c ? `<span class="count">${c}</span>` : ""}</a>`).join("")}`).join("");
}
