// UI helpers shared by every screen.
import { AIR_STATUS, POSTING_STATE } from "./core/logic.js";

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- formatting ---------- */
export function toDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d); }
  const d = new Date(v); return isNaN(d) ? null : d;
}
const MANILA = { timeZone: "Asia/Manila" };
export function fmtDate(v) {
  const d = toDate(v); if (!d) return "—";
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric", ...(typeof v === "string" && v.length === 10 ? {} : MANILA) });
}
export function fmtDateTime(v) {
  const d = toDate(v); if (!d) return "—";
  return d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...MANILA });
}
export const money = n => "₱" + (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = n => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const qty = n => (Number(n) || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 });
export const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
export function initials(s) {
  const words = String(s?.displayName || s?.email || "?").split(/[\s@.]+/).filter(Boolean);
  return words.slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
export function avatar(person, size = "") {
  if (person?.photoURL) return `<img class="avatar ${size}" src="${esc(person.photoURL)}" alt="" referrerpolicy="no-referrer">`;
  return `<span class="avatar ${size}" aria-hidden="true">${esc(initials(person))}</span>`;
}

/* ---------- badges ---------- */
const B = (txt, cls = "") => `<span class="badge ${cls}">${esc(txt)}</span>`;
export const airBadge = s => B(AIR_STATUS[s] || s, { draft: "", submitted: "b-info", returned: "b-bad", approved: "b-gold", issued: "b-ok", cancelled: "b-dark" }[s] || "");
export const postBadge = s => B(POSTING_STATE[s] || s, { none: "", unposted: "b-warn", partial: "b-info", posted: "b-ok" }[s] || "");
export const docStatusBadge = d => d.status === "cancelled" ? B("Cancelled", "b-dark") : d.posting?.posted ? B("Posted", "b-ok") : B("For Posting", "b-warn");
export const userBadge = s => B({ pending: "Pending approval", active: "Active", declined: "Declined", disabled: "Disabled" }[s] || s, { pending: "b-warn", active: "b-ok", declined: "b-bad", disabled: "" }[s] || "");
export const catBadge = c => B({ ppe: "PPE", sx: "Semi-Exp.", cons: "Supplies" }[c] || "Unclassified", { ppe: "b-dark", sx: "b-gold", cons: "b-info" }[c] || "");

/* ---------- toast, modal, confirm ---------- */
export function toast(msg, kind = "") {
  const d = document.createElement("div");
  d.textContent = msg; if (kind) d.className = kind;
  $("#toasts").appendChild(d);
  setTimeout(() => d.remove(), kind === "err" ? 8000 : 4000);
}

export function openModal(html, { size = "", onClose } = {}) {
  const root = $("#modal-root");
  const wrap = document.createElement("div");
  wrap.className = "modal-back";
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true"><button class="x" aria-label="Close">×</button>${html}</div>`;
  root.appendChild(wrap);
  const m = $(".modal", wrap);
  const close = () => { wrap.remove(); onClose && onClose(); };
  $(".x", wrap).onclick = close;
  wrap.addEventListener("mousedown", e => { if (e.target === wrap) close(); });
  m.close = close;
  // focus the first field, unless the user has already moved into one
  const first = m.querySelector("input:not([type=hidden]),select,textarea"); first && setTimeout(() => { if (!m.contains(document.activeElement)) first.focus(); }, 30);
  return m;
}
export function closeModals() { $("#modal-root").innerHTML = ""; }
document.addEventListener("keydown", e => { if (e.key === "Escape") { const last = $$("#modal-root .modal-back").at(-1); last && $(".x", last).click(); } });

/** Confirmation dialog with optional fields. Resolves to the values ({} if none) or null when cancelled. */
export function confirmBox({ title, body = "", confirmText = "Confirm", danger = false, fields = [] }) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal(`
      <h2>${esc(title)}</h2>${body ? `<div class="muted" style="margin-bottom:.8rem">${body}</div>` : ""}
      <form class="grid">${fields.map(fieldHtml).join("")}<div class="form-msg err" id="cb-msg"></div>
      <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn ${danger ? "danger solid" : "primary"}">${esc(confirmText)}</button></div></form>`,
      { size: "narrow", onClose: () => { if (!done) resolve(null); } });
    $("[data-cancel]", m).onclick = () => m.close();
    $("form", m).onsubmit = e => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.target).entries());
      const missing = fields.filter(f => f.required && !String(values[f.name] || "").trim());
      if (missing.length) { $("#cb-msg", m).textContent = `${missing[0].label} is required.`; return; }
      done = true; m.close(); resolve(values);
    };
  });
}
export function fieldHtml(f) {
  const id = `f_${f.name}_${Math.random().toString(36).slice(2, 7)}`;
  const lab = `<label for="${id}" class="${f.required ? "req" : ""}">${esc(f.label)}</label>`;
  const common = `id="${id}" name="${esc(f.name)}" ${f.required ? "required" : ""}`;
  let input;
  if (f.type === "select") input = `<select ${common}>${opts(f.options || [], f.value)}</select>`;
  else if (f.type === "textarea") input = `<textarea ${common} placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea>`;
  else input = `<input type="${f.type || "text"}" ${common} value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder || "")}">`;
  return `<div class="${f.span || ""}">${lab}${input}${f.hint ? `<div class="xs muted" style="margin-top:.2rem">${esc(f.hint)}</div>` : ""}</div>`;
}
export const opts = (list, selected, blank) => (blank !== undefined ? `<option value="">${esc(blank)}</option>` : "") +
  list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(selected ?? "") ? "selected" : ""}>${esc(l)}</option>`; }).join("");
/** <option>s for account catalog rows [group, code, name], grouped by <optgroup>. */
export function accountOpts(rows, selected, blank = "Choose account") {
  const groups = [...new Set(rows.map(r => r[0]))];
  return `<option value="">${esc(blank)}</option>` + groups.map(g => `<optgroup label="${esc(g)}">${rows.filter(r => r[0] === g).map(r =>
    `<option value="${r[1]}" ${r[1] === String(selected || "") ? "selected" : ""}>${r[1]} — ${esc(r[2])}</option>`).join("")}</optgroup>`).join("");
}
export const datalist = (id, list) => `<datalist id="${esc(id)}">${list.map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;

/** Runs an async action with the button disabled; shows errors as toasts. */
export async function busy(btn, fn, okMsg) {
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = "Working…"; }
  try { const r = await fn(); if (okMsg) toast(okMsg, "ok"); return r; }
  catch (e) { toast(e.message || String(e), "err"); throw e; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}

/* ---------- data table ---------- */
/**
 * renderTable(el, { id, columns:[{label,render(row),sort(row),cls,headCls}], rows, searchText(row),
 *   filters:[{key,label,options,test(row,val),value}], pageSize, onRow(row), empty, tools, footer(rows) })
 */
const tableState = new Map();
export function renderTable(el, cfg) {
  const fresh = !cfg.id || !tableState.has(cfg.id);
  const st = (cfg.id && tableState.get(cfg.id)) || { q: "", sort: cfg.defaultSort ?? null, dir: cfg.defaultDir || 1, page: 0, filters: {} };
  if (cfg.id) tableState.set(cfg.id, st);
  const pageSize = cfg.pageSize || 25;
  el.innerHTML = `
    <div class="table-tools">
      ${cfg.searchText ? `<div class="grow"><label>Search</label><input type="search" data-q data-nodirty placeholder="${esc(cfg.searchPlaceholder || "Search")}"></div>` : ""}
      ${(cfg.filters || []).map(f => `<div><label>${esc(f.label)}</label><select data-f="${esc(f.key)}" data-nodirty>${opts(f.options, f.value ?? "", "All")}</select></div>`).join("")}
      ${cfg.tools || ""}
    </div>
    <div class="table-wrap"><table><thead><tr>${cfg.columns.map((c, i) => `<th class="${c.sort ? "sortable" : ""} ${c.headCls || ""}" data-i="${i}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody></tbody><tfoot></tfoot></table></div>
    <div class="pager"></div>`;
  if (fresh) (cfg.filters || []).forEach(f => { if (f.value) st.filters[f.key] = f.value; });
  const q0 = $("[data-q]", el); if (q0) q0.value = st.q;
  $$("[data-f]", el).forEach(s => { if (st.filters[s.dataset.f] !== undefined) s.value = st.filters[s.dataset.f]; });
  const rows = cfg.rows || [];
  const draw = () => {
    let list = rows.filter(r => (!st.q || cfg.searchText(r).toLowerCase().includes(st.q)) &&
      (cfg.filters || []).every(f => !st.filters[f.key] || f.test(r, st.filters[f.key])));
    if (st.sort != null) {
      const c = cfg.columns[st.sort];
      list = [...list].sort((a, b) => { const x = c.sort(a), y = c.sort(b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
    }
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    st.page = Math.min(st.page, pages - 1);
    const view = list.slice(st.page * pageSize, (st.page + 1) * pageSize);
    $("tbody", el).innerHTML = view.length ? view.map((r, i) => `<tr data-r="${i}" class="${cfg.onRow ? "click" : ""}">${cfg.columns.map(c => `<td class="${c.cls || ""}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${cfg.columns.length}" class="empty">${esc(rows.length ? "No records match these filters." : cfg.empty || "No records yet.")}</td></tr>`;
    $("tfoot", el).innerHTML = cfg.footer && list.length ? cfg.footer(list) : "";
    $$("th", el).forEach((th, i) => { th.classList.toggle("asc", st.sort === i && st.dir === 1); th.classList.toggle("desc", st.sort === i && st.dir === -1); });
    if (cfg.onRow) $$("tbody tr[data-r]", el).forEach(tr => tr.onclick = e => { if (!e.target.closest("button,a,input,select")) cfg.onRow(view[+tr.dataset.r]); });
    $(".pager", el).innerHTML = list.length > pageSize
      ? `<span>${st.page * pageSize + 1}–${Math.min(list.length, (st.page + 1) * pageSize)} of ${list.length}</span><span class="btn-row"><button class="btn sm" data-p="-1" ${st.page ? "" : "disabled"}>Previous</button><button class="btn sm" data-p="1" ${st.page < pages - 1 ? "" : "disabled"}>Next</button></span>`
      : `<span>${list.length} record${list.length === 1 ? "" : "s"}</span>`;
    $$(".pager [data-p]", el).forEach(b => b.onclick = () => { st.page += +b.dataset.p; draw(); });
    el.currentRows = list;
  };
  const q = $("[data-q]", el); if (q) q.oninput = () => { st.q = q.value.trim().toLowerCase(); st.page = 0; draw(); };
  $$("[data-f]", el).forEach(s => s.onchange = () => { st.filters[s.dataset.f] = s.value; st.page = 0; draw(); });
  $$("th.sortable", el).forEach(th => th.onclick = () => { const i = +th.dataset.i; st.dir = st.sort === i ? -st.dir : 1; st.sort = i; draw(); });
  draw();
  return { rows: () => el.currentRows || [] };
}

/* ---------- export ---------- */
export function downloadCSV(name, headers, rows) {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(q).join(","), ...rows.map(r => r.map(q).join(","))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = name.endsWith(".csv") ? name : name + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ---------- spreadsheets (SheetJS, loaded only when needed) ---------- */
let xlsxLoading = null;
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxLoading ||= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => res(window.XLSX); s.onerror = () => { xlsxLoading = null; rej(new Error("Could not load the spreadsheet reader. Check your internet connection.")); };
    document.head.appendChild(s);
  });
  return xlsxLoading;
}
/** First sheet of an Excel/CSV file as objects keyed by header (dates as YYYY-MM-DD), or JSON arrays as they are. */
export async function readRows(file) {
  if (/\.json$/i.test(file.name)) { const d = JSON.parse(await file.text()); return Array.isArray(d) ? d : Object.values(d.assets || d.items || d); }
  const X = await loadXLSX();
  const isCsv = /\.csv$/i.test(file.name);
  const wb = isCsv ? X.read(await file.text(), { type: "string", raw: true }) : X.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true })
    .map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? ymd(v) : typeof v === "number" ? String(v) : v])));
}
/** First sheet as tab-separated text (for the Trial Balance box). */
export async function sheetAsText(file) {
  if (/\.csv$/i.test(file.name) || /\.txt$/i.test(file.name)) return file.text();
  const X = await loadXLSX();
  const wb = X.read(await file.arrayBuffer(), { type: "array" });
  return X.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: "\t" });
}
/** Only http(s) links are rendered as links; anything else (e.g. javascript:) is dropped. */
export const safeLink = u => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || "")) ? String(u) : "");
/** Office dropdown from the standard list; a value not in the list (older records) is kept as an extra choice. */
export function officeSelect(name, value, offices, { required = false, blank = "Choose office" } = {}) {
  const list = value && !offices.includes(value) ? [[value, `${value} (not in the list)`], ...offices] : offices;
  return `<select name="${esc(name)}" ${required ? "required" : ""}>${opts(list, value || "", blank)}</select>`;
}
