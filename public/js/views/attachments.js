// Attachments panel: signed PAR / ICS / RIS, PTR and other scanned documents or links, on a document or a register item.
import { S, can } from "../state.js";
import { $, $$, esc, busy, toast, fmtDateTime, opts, confirmBox } from "../ui.js";
import { addAttachment, attachmentUrl, removeAttachment, ATTACH_TYPES } from "../data.js";

export const ATTACH_LABELS = ["Signed PAR", "Signed ICS", "Signed RIS", "Signed PTR / ITR", "Signed PRS / RRSP", "Disposal / IIRUP document", "Delivery receipt / invoice", "Photo", "Other"];
const size = n => !n ? "" : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
const ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.1l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/></svg>`;

/** Attachments on these targets ([{ type, id }]), newest first. */
export const attachmentsOf = targets => S.d.attachments.filter(a => targets.some(t => a.target?.type === t.type && a.target?.id === t.id))
  .sort((x, y) => (y.at?.seconds || 0) - (x.at?.seconds || 0));
export const canAttach = () => can("issue") || can("post");

/**
 * A card listing the attachments and, for the GSO and Accounting, a form to add one.
 * target: where new attachments go { type, id, office, fund, label }; also: other targets whose attachments are shown too
 * (e.g. an item's page also shows its signed PAR). defaultLabel preselects the kind of document.
 */
export function attachmentsCard(el, target, { also = [], defaultLabel = "Other", title = "Attachments" } = {}) {
  const list = attachmentsOf([target, ...also]);
  el.innerHTML = `<div class="card"><div class="card-head"><h3>${esc(title)}</h3><span class="small muted">${list.length || ""}</span></div>
    ${list.length ? `<ul class="attach">${list.map(a => `<li data-id="${esc(a.id)}"><span class="ic">${ICON}</span><div class="t"><b>${esc(a.label)}</b>${a.target.id !== target.id ? ` <span class="xs muted">· on ${esc(a.about || a.target.type)}</span>` : ""}
        <div class="xs muted">${esc(a.name)}${a.size ? ` · ${size(a.size)}` : a.kind === "link" ? " · link" : ""} · ${fmtDateTime(a.at)} · ${esc(a.uploadedBy?.name || "")}</div></div>
        <div class="btn-row"><button class="btn sm" data-open>Open</button>${canAttach() ? `<button class="btn sm ghost danger" data-rm title="Remove">Remove</button>` : ""}</div></li>`).join("")}</ul>`
      : `<p class="muted small" style="margin:0">${canAttach() ? "No documents attached yet — attach the signed copy once it comes back." : "No documents attached."}</p>`}
    ${canAttach() ? `<form class="grid g3" data-af data-nodirty style="margin-top:1rem;align-items:end">
        <div><label>Document</label><select name="label">${opts(ATTACH_LABELS, defaultLabel)}</select></div>
        <div><label>File (PDF, JPG or PNG, up to 5 MB)</label><input type="file" name="file" accept="${ATTACH_TYPES.join(",")}"></div>
        <div><label>…or a link</label><input name="url" placeholder="https://drive.google.com/…"></div>
        <div class="spanall btn-row end"><button class="btn primary sm" type="submit">Attach</button></div></form>` : ""}</div>`;
  const form = $("[data-af]", el);
  if (form) form.onsubmit = e => {
    e.preventDefault();
    const file = form.file.files[0], url = form.url.value.trim();
    if (!file && !url) return toast("Choose a file, or paste a link.", "err");
    busy(e.submitter, async () => { await addAttachment(target, { label: form.label.value, file, url: file ? "" : url }); form.reset(); form.label.value = defaultLabel; }, "Attached.").catch(() => {});
  };
  $$("[data-open]", el).forEach(b => b.onclick = () => {
    const a = list.find(x => x.id === b.closest("li").dataset.id);
    const w = window.open("", "_blank"); // opened right away so the browser doesn't block it
    busy(b, async () => {
      const url = await attachmentUrl(a);
      if (w) w.location.href = url; else location.href = url;
      if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).catch(() => w?.close());
  });
  $$("[data-rm]", el).forEach(b => b.onclick = async () => {
    const a = list.find(x => x.id === b.closest("li").dataset.id);
    if (await confirmBox({ title: `Remove “${a.label}”?`, body: esc(a.name), confirmText: "Remove", danger: true })) busy(b, () => removeAttachment(a), "Removed.").catch(() => {});
  });
}
