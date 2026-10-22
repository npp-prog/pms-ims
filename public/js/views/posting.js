// Accounting: indicates whether each AIR's supply receipt and its PAR / ICS / RIS are posted in the registry.
import { S, can, fundAirs, docsOfAir } from "../state.js";
import { $, $$, esc, busy, money, fmtDate, manilaToday, renderTable, openModal, confirmBox, postBadge, downloadCSV } from "../ui.js";
import { fundName, DOC_TYPES } from "../core/catalog.js";
import { postingSummary, POSTING_STATE } from "../core/logic.js";
import { setPosting } from "../data.js";
import { postingItems } from "./common.js";

const REGISTRY = { air: "Supplies Ledger Card (receipt)", par: DOC_TYPES.par.registry, ics: DOC_TYPES.ics.registry, ris: DOC_TYPES.ris.registry,
  dsp: "Derecognition — PPE / SE ledger (carrying amount)", ptr: "Derecognition — donated PPE (carrying amount)", itr: "Derecognition — donated semi-expendable" };
const itemLabel = i => i.kind === "air" ? `AIR ${i.number} — supply receipt` : `${i.label} ${i.number}`;
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
export function queue(main) {
  const rows = postingItems().filter(i => !i.posting.posted);
  main.innerHTML = `<div class="page-head"><div><h1>For Posting</h1><p>Supply receipts and PAR / ICS / RIS in the ${esc(fundName(S.fund))} that Accounting has not yet posted in the registry. Select several to post them under one JEV.</p></div>
    <button class="btn primary" id="bulk" disabled>Post selected</button></div><div class="card" id="t"></div>`;
  const sel = new Set();
  const t = renderTable($("#t", main), {
    id: "posting", rows, pageSize: 50, defaultSort: 1,
    searchText: i => `${i.number} ${i.airNo} ${i.office} ${i.recipient || ""}`,
    filters: [{ key: "k", label: "Type", options: [["air", "AIR receipt"], ["par", "PAR"], ["ics", "ICS"], ["ris", "RIS"], ["movement", "Disposal / donation"]], test: (i, v) => v === "movement" ? i.kind === "movement" : (i.kind === "air" ? "air" : i.docType) === v }],
    columns: [
      { label: "", render: i => `<input type="checkbox" data-nodirty data-sel="${esc(i.kind + ":" + i.id)}" ${sel.has(i.kind + ":" + i.id) ? "checked" : ""}>` },
      { label: "Date", render: i => fmtDate(i.date), sort: i => i.date || "" },
      { label: "Document", render: i => `<b>${esc(itemLabel(i))}</b><div class="xs muted">${esc(regOf(i))}</div>`, sort: i => i.number },
      { label: "AIR No.", render: i => i.airId ? `<a href="#/airs/${i.airId}">${esc(i.airNo)}</a>` : i.kind === "movement" ? `<a href="#/movements/${i.id}">open</a>` : `<a href="#/issuances/${i.id}">register items</a>`, sort: i => i.airNo },
      { label: "Office / recipient", render: i => `${esc(i.office)}${i.recipient ? `<div class="xs muted">${esc(i.recipient)}</div>` : ""}` },
      { label: "Amount", render: i => money(i.amount), sort: i => i.amount, cls: "right", headCls: "right" },
      { label: "", render: i => `<button class="btn sm primary" data-post="${esc(i.kind + ":" + i.id)}">Post</button>` }
    ],
    empty: "Everything in this fund is posted.",
    footer: list => `<tr><td colspan="5" class="right">Total</td><td class="right">${money(list.reduce((t, i) => t + i.amount, 0))}</td><td></td></tr>`
  });
  const find = k => rows.find(i => i.kind + ":" + i.id === k);
  $("#t", main).addEventListener("click", e => {
    const b = e.target.closest("[data-post]"); if (b) return postModal([find(b.dataset.post)]);
    const c = e.target.closest("[data-sel]"); if (c) { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); $("#bulk", main).disabled = !sel.size; $("#bulk", main).textContent = sel.size ? `Post selected (${sel.size})` : "Post selected"; }
  });
  $("#bulk", main).onclick = () => postModal([...sel].map(find).filter(Boolean));
  void t;
}
queue.deps = ["r:airs", "r:docs", "r:movements", "fund"];

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
    <div class="modal-actions"><a class="btn" href="#/airs/${a.id}">Open AIR</a><button class="btn" data-x>Close</button></div>`);
  $("[data-x]", m).onclick = () => m.close();
  $$("[data-po]", m).forEach(b => b.onclick = () => { m.close(); postModal([items[+b.dataset.po]]); });
  $$("[data-un]", m).forEach(b => b.onclick = () => { m.close(); unpost(items[+b.dataset.un], b); });
}
