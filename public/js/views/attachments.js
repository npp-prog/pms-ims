// Attachments panel: signed PAR / ICS / RIS, PTR and other scanned documents or links, on a document or a register item.
import { S, can, onChange } from "../state.js";
import { $, $$, esc, busy, toast, fmtDateTime, opts, confirmBox, openModal } from "../ui.js";
import { addAttachment, attachmentUrl, removeAttachment, ATTACH_TYPES } from "../data.js";

export const ATTACH_LABELS = ["Signed PAR", "Signed ICS", "Signed RIS", "Signed PTR / ITR", "Signed PRS / RRSP", "Disposal / IIRUP document", "Delivery receipt / invoice", "Photo", "Other"];
const size = n => !n ? "" : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
const ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.1l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/></svg>`;

/** Attachments on these targets ([{ type, id }]), newest first. */
export const attachmentsOf = targets => S.d.attachments.filter(a => targets.some(t => a.target?.type === t.type && a.target?.id === t.id))
  .sort((x, y) => (y.at?.seconds || 0) - (x.at?.seconds || 0));
export const canAttach = () => can("issue") || can("post");

const extOf = a => (String(a.name || "").match(/\.([a-z0-9]{2,5})$/i) || [])[1] || ({ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[a.mime] || "");
/** The name a file is shown and saved under: as uploaded, or — with a prefix (e.g. the approved AIR No.) — "<prefix>-<document type>". */
export const attachmentName = (a, prefix = "") => !prefix || a.kind === "link" ? a.name : `${prefix}-${a.label}`.replace(/[\\/:*?"<>|]+/g, "-") + (extOf(a) ? `.${extOf(a)}` : "");

/**
 * A card listing the attachments and, for the GSO and Accounting, a form to add one.
 * target: where new attachments go { type, id, office, fund, label }; also: other targets whose attachments are shown too
 * (e.g. an item's page also shows its signed PAR). defaultLabel preselects the kind of document.
 * labels: the document types offered; canAdd: who may attach (default GSO and Accounting); canRemove(a): who may remove one;
 * namePrefix: files are shown and downloaded as "<namePrefix>-<document type>" (e.g. the AIR No. once the GSO gives it).
 */
export function attachmentsCard(el, target, options = {}) {
  const { also = [], defaultLabel = "Other", title = "Attachments", labels = ATTACH_LABELS, canAdd = canAttach(), canRemove = () => canAttach(), namePrefix = "", note = "" } = options;
  // redraw when attachments change while the card is on screen (pages redraw themselves; a card in a dialog doesn't)
  if (!el._attWatch) { el._attWatch = true; const off = onChange(k => { if (!el.isConnected) { off(); return; } if (k === "r:attachments" && !el.querySelector("[data-af] :focus")) attachmentsCard(el, target, options); }); }
  const list = attachmentsOf([target, ...also]);
  el.innerHTML = `<div class="card"><div class="card-head"><h3>${esc(title)}</h3><span class="small muted">${list.length || ""}</span></div>
    ${note ? `<p class="small muted" style="margin-top:0">${note}</p>` : ""}
    ${list.length ? `<ul class="attach">${list.map(a => { const nm = attachmentName(a, a.target.id === target.id ? namePrefix : ""), when = `${a.size ? `${size(a.size)} · ` : a.kind === "link" ? "link · " : ""}${fmtDateTime(a.at)}`;
        return `<li data-id="${esc(a.id)}"><span class="ic">${ICON}</span><div class="t">
        <div class="one"><b>${esc(a.label)}</b>${a.target.id !== target.id ? ` <span class="xs muted">· on ${esc(a.about || a.target.type)}</span>` : ""}</div>
        <div class="one xs" title="${esc(nm)}">${esc(nm)}</div>
        <div class="one xs muted" title="${esc(when)}">${esc(when)}</div>
        ${a.uploadedBy?.name ? `<div class="one xs muted" title="${esc(a.uploadedBy.name)}">${esc(a.uploadedBy.name)}</div>` : ""}</div>
        <div class="btn-row acts"><button class="btn sm" data-open>Open</button>${a.kind === "file" ? `<button class="btn sm" data-dl>Download</button>` : ""}${canRemove(a) ? `<button class="btn sm ghost danger" data-rm title="Remove">Remove</button>` : ""}</div></li>`; }).join("")}</ul>`
      : `<p class="muted small" style="margin:0">${canAdd ? "No documents attached yet." : "No documents attached."}</p>`}
    ${canAdd ? `<form class="att-form" data-af>
        <div><label>Document</label><select name="label">${opts(labels, defaultLabel)}</select></div>
        <div><label>File (PDF, JPG or PNG, up to 5 MB)</label><input type="file" name="file" accept="${ATTACH_TYPES.join(",")}"></div>
        <div class="btn-row end att-go"><button class="btn primary sm" type="submit">Attach</button></div></form>` : ""}</div>`;
  const form = $("[data-af]", el);
  if (form) form.onsubmit = e => {
    e.preventDefault();
    const file = form.file.files[0];
    if (!file) return toast("Choose a file to attach.", "err");
    // what is being typed here counts as unsaved, so a live update doesn't wipe it; attaching clears it
    busy(e.submitter, async () => { await addAttachment(target, { label: form.label.value, file }); form.reset(); form.label.value = defaultLabel; window.dispatchEvent(new Event("app:clean")); }, "Attached.").catch(() => {});
  };
  $$("[data-open]", el).forEach(b => b.onclick = () => {
    const a = list.find(x => x.id === b.closest("li").dataset.id);
    // a link attached earlier (e.g. Google Drive) can't be shown inside the page: it opens in a new tab
    if (a.kind === "link") { window.open(a.url, "_blank", "noopener"); return; }
    busy(b, async () => viewAttachment(a, attachmentName(a, a.target.id === target.id ? namePrefix : ""), await attachmentUrl(a))).catch(() => {});
  });
  $$("[data-dl]", el).forEach(b => b.onclick = () => {
    const a = list.find(x => x.id === b.closest("li").dataset.id);
    busy(b, async () => {
      const url = await attachmentUrl(a), link = document.createElement("a");
      link.href = url; link.download = attachmentName(a, a.target.id === target.id ? namePrefix : ""); link.click();
      if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).catch(() => {});
  });
  $$("[data-rm]", el).forEach(b => b.onclick = async () => {
    const a = list.find(x => x.id === b.closest("li").dataset.id);
    if (await confirmBox({ title: `Remove “${a.label}”?`, body: esc(a.name), confirmText: "Remove", danger: true })) busy(b, () => removeAttachment(a), "Removed.").catch(() => {});
  });
}

/** Shows a file in a pop-up: images as they are, PDFs in the browser's PDF viewer. */
function viewAttachment(a, name, url) {
  const img = /^image\//.test(a.mime || "");
  const m = openModal(`<div class="card-head" style="margin-bottom:.6rem"><h3 style="margin:0">${esc(a.label)}</h3><span class="small muted">${esc(name)}</span></div>
    <div class="doc-view">${img ? `<img src="${url}" alt="${esc(a.label)}">` : `<iframe src="${url}" title="${esc(name)}"></iframe>`}</div>
    <div class="modal-actions"><a class="btn" href="${url}" download="${esc(name)}">Download</a><button type="button" class="btn primary" data-close>Close</button></div>`,
    { size: "wide", onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000) });
  $("[data-close]", m).onclick = () => m.close();
}
