// Accounting: indicates whether each AIR's supply receipt and its PAR / ICS / RIS are posted in the registry.
import { S, can, fundAirs, docsOfAir } from "../state.js";
import { $, $$, esc, busy, money, fmtDate, manilaToday, renderTable, openModal, confirmBox, postBadge, downloadCSV } from "../ui.js";
import { fundName, DOC_TYPES } from "../core/catalog.js";
import { postingSummary, POSTING_STATE } from "../core/logic.js";
import { setPosting, postSelected } from "../data.js";
import { postingItems } from "./common.js";

const REGISTRY = { air: "AIR — everything received", par: DOC_TYPES.par.registry, ics: DOC_TYPES.ics.registry, ris: DOC_TYPES.ris.registry,
  repair: "Repairs and maintenance — History of Repair", rsmi: "Supplies issued (RSMI) — expense and inventory", dsp: "Derecognition — PPE / SE ledger (carrying amount)", ptr: "Derecognition — donated PPE (carrying amount)", itr: "Derecognition — donated semi-expendable" };
const itemLabel = i => i.kind === "air" ? `AIR ${i.number}` : `${i.label} ${i.number}`;
const regOf = i => REGISTRY[i.kind === "air" ? "air" : i.docType];

function postModal(items) {
  const m = openModal(`<h2>Post ${items.length === 1 ? esc(itemLabel(items[0])) : `${items.length} documents`}</h2>
    <p class="muted small">Indicates that ${items.length === 1 ? "this document is" : "these documents are"} recorded in the registry (${esc([...new Set(items.map(i => regOf(i)))].join("; "))}).</p>
    <form class="grid g2" id="pf">
      <div><label class="req">Posting date</label><input type="date" name="date" value="${manilaToday()}"></div>
      <div><label class="req">JEV / reference no.</label><input name="ref" placeholder="e.g. JEV 2026-10-0123"></div>
      <div class="spanall"><label>Remarks</label><input name="remarks"></div>
      <div class="spanall form-msg err" id="pm"></div>
      <div class="spanall modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit">Mark as posted</button></div></form>`, { size: "narrow" });
  $("[data-x]", m).onclick = () => m.close();
  $("#pf", m).onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    if (!v.date || !v.ref.trim()) { $("#pm", m).textContent = "Enter the posting date and the JEV / reference number."; return; }
    busy(e.submitter, async () => {
      for (const i of items) await setPosting(i.kind, i.id, v);
      m.close();
    }, items.length === 1 ? "Posted." : `${items.length} documents posted.`).catch(err => { $("#pm", m).textContent = err.message; });
  };
}
async function unpost(i, btn) {
  if (!(await confirmBox({ title: `Unpost ${itemLabel(i)}?`, body: "Use this only to correct a posting made in error.", confirmText: "Unpost", danger: true }))) return;
  busy(btn, () => setPosting(i.kind, i.id, null), "Posting removed.").catch(() => {});
}

/* ---------------- For Posting ---------------- */
/** One row per AIR (the AIR and every PAR / ICS / RIS issued from it, posted together), plus disposals and
 *  PAR / ICS brought over from PMS, which have no AIR. */
function queueRows() {
  const open = postingItems().filter(i => !i.posting.posted), rows = [], byAir = new Map();
  for (const i of open) {
    if (!i.airId) { rows.push({ key: `${i.kind}:${i.id}`, items: [i], date: i.date, title: itemLabel(i), sub: regOf(i), office: i.office, recipient: i.recipient, amount: i.amount }); continue; }
    if (!byAir.has(i.airId)) {
      const a = S.d.airs.find(x => x.id === i.airId) || {};
      const r = { key: `air:${i.airId}`, airId: i.airId, items: [], date: a.acceptance?.dateReceived || a.date || i.date, title: `AIR ${a.airNo || i.airNo}`, office: a.office || i.office, amount: Number(a.total) || 0, air: a };
      byAir.set(i.airId, r); rows.push(r);
    }
    byAir.get(i.airId).items.push(i);
  }
  for (const r of byAir.values()) {
    const airOpen = r.items.some(i => i.kind === "air");
    r.sub = airOpen ? "AIR and its PAR / ICS" : "Issued after the AIR was posted";
    if (!airOpen) r.amount = r.items.reduce((t, i) => t + i.amount, 0);
  }
  return rows;
}
const chip = i => `<span class="badge ${i.kind === "air" ? "b-gold" : "b-warn"}">${esc(i.kind === "air" ? "AIR" : `${i.label} ${i.number}`)}</span>`;

export function queue(main) {
  const rows = queueRows();
  main.innerHTML = `<div class="page-head"><div><h1>For Posting</h1><p>What Accounting has not yet posted in the ${esc(fundName(S.fund))}. Posting an <b>AIR</b> also posts its PAR and ICS, under one JEV; documents issued later from an AIR already posted appear here to be posted the same way. <b>RIS</b> are posted with their <b>RSMI</b>, once the GSO puts them on one (Reports → RSMI). Select several rows to post them together.</p></div>
    <button class="btn primary" id="bulk" disabled>Post selected</button></div><div class="card" id="t"></div>`;
  const sel = new Set();
  renderTable($("#t", main), {
    id: "posting", rows, pageSize: 50, defaultSort: 1,
    searchText: r => `${r.title} ${r.office} ${r.recipient || ""} ${r.items.map(i => i.number).join(" ")}`,
    filters: [{ key: "k", label: "Type", options: [["air", "AIRs and their documents"], ...(rows.some(r => !r.airId && r.items[0].kind === "doc") ? [["register", "PAR / ICS without an AIR (from PMS)"]] : []), ["movement", "Disposal / donation"], ["repair", "Repairs"], ["rsmi", "RSMI (supplies issued)"]],
      test: (r, v) => v === "air" ? !!r.airId : ["movement", "repair", "rsmi"].includes(v) ? r.items[0].kind === v : !r.airId && r.items[0].kind === "doc" }],
    columns: [
      { label: "", render: r => `<input type="checkbox" data-nodirty data-sel="${esc(r.key)}" ${sel.has(r.key) ? "checked" : ""}>` },
      { label: "Date", render: r => fmtDate(r.date), sort: r => r.date || "" },
      { label: "AIR / document", render: r => `<b>${r.airId ? `<a href="#/airs/${esc(r.airId)}">${esc(r.title)}</a>` : esc(r.title)}</b><div class="xs muted">${esc(r.sub)}</div>`, sort: r => r.title },
      { label: "To post", render: r => r.airId ? `<div class="chips">${r.items.map(chip).join("")}</div>` : r.items[0].kind === "movement" ? `<a href="#/movements/${esc(r.items[0].id)}">open</a>` : r.items[0].kind === "repair" ? `<a href="#/repairs/${esc(r.items[0].id)}">open</a>` : r.items[0].kind === "rsmi" ? `<a href="#/reports">open</a>` : `<a href="#/issuances/${esc(r.items[0].id)}">open</a>` },
      { label: "Office / recipient", render: r => `${esc(r.office)}${r.recipient ? `<div class="xs muted">${esc(r.recipient)}</div>` : ""}` },
      { label: "Amount", render: r => money(r.amount), sort: r => r.amount, cls: "right", headCls: "right" },
      { label: "", render: r => `<button class="btn sm primary" data-post="${esc(r.key)}">${r.items.length > 1 ? `Post all (${r.items.length})` : "Post"}</button>` }
    ],
    empty: "Everything in this fund is posted.",
    footer: list => `<tr><td colspan="5" class="right">Total</td><td class="right">${money(list.reduce((t, r) => t + r.amount, 0))}</td><td></td></tr>`
  });
  const find = k => rows.find(r => r.key === k);
  $("#t", main).addEventListener("click", e => {
    const b = e.target.closest("[data-post]"); if (b) return postRows([find(b.dataset.post)]);
    const c = e.target.closest("[data-sel]"); if (c) { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); $("#bulk", main).disabled = !sel.size; $("#bulk", main).textContent = sel.size ? `Post selected (${sel.size})` : "Post selected"; }
  });
  $("#bulk", main).onclick = () => postRows([...sel].map(find).filter(Boolean));
}
queue.deps = ["r:airs", "r:docs", "r:movements", "r:repairs", "r:rsmis", "fund"];

/** Posting form for queue rows: a checklist of what goes under this JEV — the AIR and its PAR / ICS are ticked, RIS are
 *  not (they are usually posted on their own); other rows post their one document. */
function postRows(rows) {
  const items = rows.flatMap(r => r.items.map(i => ({ ...i, row: r })));
  const ticked = i => i.kind !== "doc" || i.docType !== "ris" || (items.every(x => x.kind === "doc" && x.docType === "ris") && !!S.d.airs.find(a => a.id === i.airId)?.posting?.posted);
  const m = openModal(`<h2>Post ${rows.length === 1 ? esc(rows[0].title) : `${rows.length} rows`}</h2>
    <p class="muted small">Tick what is posted under this JEV. An RSMI posts every RIS on it; an RIS can be posted only once its AIR is posted (or with it).</p>
    <div class="table-wrap" style="margin-bottom:.8rem"><table><thead><tr><th></th><th>Document</th><th>Registry</th><th class="right">Amount</th></tr></thead><tbody>
      ${items.map((i, k) => `<tr><td><input type="checkbox" data-k="${k}" ${ticked(i) ? "checked" : ""}></td><td><b>${esc(i.kind === "air" ? `AIR ${i.number}` : itemLabel(i))}</b>${rows.length > 1 && i.kind !== "air" && i.row.airId ? `<div class="xs muted">${esc(i.row.title)}</div>` : ""}</td>
        <td class="small">${esc(regOf(i))}</td><td class="right">${money(i.amount)}</td></tr>`).join("")}
    </tbody></table></div>
    <form class="grid g2" id="pf">
      <div><label class="req">Posting date</label><input type="date" name="date" value="${manilaToday()}"></div>
      <div><label class="req">JEV / reference no.</label><input name="ref" placeholder="e.g. JEV 2026-10-0123"></div>
      <div class="spanall"><label>Remarks</label><input name="remarks"></div>
      <div class="spanall form-msg err" id="pm"></div>
      <div class="spanall modal-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" type="submit" id="pgo">Post</button></div></form>`, { size: "wide" });
  const boxes = () => $$("[data-k]", m).filter(b => b.checked).map(b => items[+b.dataset.k]);
  // an RIS needs its AIR posted, or ticked in this same posting
  const airPosted = id => !!S.d.airs.find(a => a.id === id)?.posting?.posted;
  const sync = () => $$("[data-k]", m).forEach(b => {
    const i = items[+b.dataset.k]; if (i.kind !== "doc" || i.docType !== "ris") return;
    const ok = airPosted(i.airId) || $$("[data-k]", m).some(x => x.checked && items[+x.dataset.k].kind === "air" && items[+x.dataset.k].id === i.airId);
    b.disabled = !ok; if (!ok) b.checked = false; b.title = ok ? "" : "Post the AIR first (or tick it too)";
  });
  const label = () => { sync(); const n = boxes().length; $("#pgo", m).textContent = n === 1 ? "Post 1 document" : `Post ${n} documents`; $("#pgo", m).disabled = !n; };
  m.addEventListener("change", e => { if (e.target.matches("[data-k]")) label(); }); label();
  $("[data-x]", m).onclick = () => m.close();
  $("#pf", m).onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries()), list = boxes();
    if (!v.date || !v.ref.trim()) { $("#pm", m).textContent = "Enter the posting date and the JEV / reference number."; return; }
    busy(e.submitter, async () => { await postSelected(list.map(i => ({ kind: i.kind, id: i.id })), v); m.close(); },
      list.length === 1 ? "Posted." : `${list.length} documents posted.`).catch(err => { $("#pm", m).textContent = err.message; });
  };
}

/* ---------------- Posting Status (per AIR) ---------------- */
export function status(main) {
  const airs = fundAirs().filter(a => ["approved", "issued"].includes(a.status));
  const rows = airs.map(a => ({ a, s: postingSummary(a, docsOfAir(a.id)) }));
  main.innerHTML = `<div class="page-head"><div><h1>Posting Status</h1><p>For every approved AIR in the ${esc(fundName(S.fund))}: whether the items received, and the PAR / ICS / RIS issued for them, are posted in the registry.</p></div>
    <button class="btn" id="csv">Download CSV</button></div><div class="card" id="t"></div>`;
  const t = renderTable($("#t", main), {
    id: "posted", rows, pageSize: 30, defaultSort: 0, defaultDir: -1,
    searchText: r => `${r.a.airNo} ${r.a.office} ${r.a.supplier} ${docsOfAir(r.a.id).map(d => d.number).join(" ")}`,
    filters: [{ key: "s", label: "Posting", options: Object.entries(POSTING_STATE).filter(([k]) => k !== "none"), test: (r, v) => r.s.state === v }],
    columns: [
      { label: "AIR No.", render: r => `<b>${esc(r.a.airNo)}</b><div class="xs muted">${fmtDate(r.a.date)}</div>`, sort: r => r.a.airNo },
      { label: "Office", render: r => esc(r.a.office), sort: r => r.a.office },
      { label: "Documents", render: r => docsCell(r.a) },
      { label: "Amount", render: r => money(r.a.total), cls: "right", headCls: "right", sort: r => r.a.total },
      { label: "Posting", render: r => `${postBadge(r.s.state)}<div class="xs muted">${r.s.posted} of ${r.s.total} posted${r.s.unissued ? " · items not yet issued" : ""}</div>`, sort: r => r.s.state }
    ],
    empty: "No approved AIRs in this fund yet.",
    onRow: r => airModal(r.a)
  });
  $("#csv", main).onclick = () => downloadCSV(`Posting-Status-${S.fund}`, ["AIR No.", "AIR Date", "Office", "Supplier", "Amount", "Document", "Doc Date", "Doc Amount", "Posted", "JEV/Ref", "Posting Date", "Posted By"],
    t.rows().flatMap(({ a }) => itemsOf(a).map(i => [a.airNo, a.date, a.office, a.supplier, a.total, itemLabel(i), i.date, i.amount, i.posting.posted ? "Yes" : "No", i.posting.ref || "", i.posting.date || "", i.posting.by?.name || ""])));
}
status.deps = ["r:airs", "r:docs", "fund"];

const itemsOf = a => postingItems().filter(i => i.airId === a.id);
function docsCell(a) {
  return itemsOf(a).map(i => `<span class="badge ${i.posting.posted ? "b-ok" : "b-warn"}" title="${i.posting.posted ? `Posted ${esc(i.posting.ref)}` : "Not posted"}">${esc(i.kind === "air" ? "AIR receipt" : `${i.label} ${i.number}`)}</span>`).join(" ") || `<span class="muted small">Nothing issued yet</span>`;
}
function airModal(a) {
  const items = itemsOf(a);
  const m = openModal(`<h2>AIR ${esc(a.airNo)} — posting</h2><p class="muted small">${esc(a.office)} · ${esc(a.supplier)} · ${money(a.total)}</p>
    ${items.map((i, n) => `<div class="post-row ${i.posting.posted ? "posted" : ""}"><div><b>${esc(itemLabel(i))}</b> · ${money(i.amount)}<div class="xs muted">${esc(regOf(i))}</div>
      ${i.posting.posted ? `<div class="xs">Posted ${fmtDate(i.posting.date)} · ${esc(i.posting.ref)} · ${esc(i.posting.by?.name)}</div>` : ""}</div>
      <div>${can("post") ? (i.posting.posted ? `<button class="btn sm danger" data-un="${n}">Unpost</button>` : `<button class="btn sm primary" data-po="${n}">Post</button>`) : ""}</div></div>`).join("") || `<p class="muted">Nothing to post yet.</p>`}
    <div class="modal-actions"><a class="btn" href="#/airs/${a.id}">Open AIR</a>${can("post") && items.some(i => !i.posting.posted) ? `<button class="btn primary" id="pall">Post AIR and all its documents</button>` : ""}<button class="btn" data-x>Close</button></div>`);
  $("[data-x]", m).onclick = () => m.close();
  $("#pall", m) && ($("#pall", m).onclick = () => { m.close(); postRows([{ key: `air:${a.id}`, airId: a.id, title: `AIR ${a.airNo}`, items: items.filter(i => !i.posting.posted) }]); });
  $$("[data-po]", m).forEach(b => b.onclick = () => { m.close(); postModal([items[+b.dataset.po]]); });
  $$("[data-un]", m).forEach(b => b.onclick = () => { m.close(); unpost(items[+b.dataset.un], b); });
}
