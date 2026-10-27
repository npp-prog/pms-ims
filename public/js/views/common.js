// Small pieces shared by several screens: work-queue counts and the "posting items" of the fund.
import { S, fundAirs, fundDocs, can, isAdmin } from "../state.js";
import { remainingQty } from "../core/logic.js";

/** Accounting's to-do list: every approved AIR (what was received), every live PAR / ICS / RIS, and disposals. */
export function postingItems() {
  const items = [];
  for (const a of fundAirs()) if (["approved", "issued"].includes(a.status))
    items.push({ kind: "air", id: a.id, label: "AIR", number: a.airNo, date: a.acceptance?.dateReceived || a.date, airId: a.id, airNo: a.airNo, office: a.office,
      amount: Number(a.total) || 0, posting: a.posting || { posted: false } });
  for (const d of fundDocs()) if (d.status !== "cancelled")
    items.push({ kind: "doc", docType: d.docType, id: d.id, label: d.docType.toUpperCase(), number: d.number, date: d.date, airId: d.airId, airNo: d.airNo,
      office: d.recipient?.office || d.office, recipient: d.recipient?.name, amount: d.total, posting: d.posting || { posted: false } });
  for (const m of S.d.movements) if (m.fund === S.fund && m.needsPosting && m.status !== "cancelled")
    items.push({ kind: "movement", docType: m.docType, id: m.id, label: m.docType === "dsp" ? "Disposal" : `${m.docType.toUpperCase()} (donation)`, number: m.number, date: m.date,
      airId: "", airNo: "", office: m.from?.office || "", recipient: m.from?.name, amount: m.carryingTotal ?? m.total, posting: m.posting || { posted: false } });
  // repairs, once the GSO has inspected them after the repair
  for (const r of S.d.repairs || []) if (r.fund === S.fund && ["inspected", "posted", "verified"].includes(r.status))
    items.push({ kind: "repair", docType: "repair", id: r.id, label: "Repair JO", number: r.jobOrderNo, date: r.postInspection?.date || r.jobOrderDate, airId: "", airNo: "",
      office: r.office, recipient: r.endUser, amount: r.totalCost, posting: r.posting || { posted: false } });
  return items;
}

export function counts() {
  const airs = fundAirs();
  const c = {
    inspect: can("inspectAir") ? airs.filter(a => a.status === "submitted").length : 0,
    issue: can("issue") ? airs.filter(a => a.status === "approved").length : 0,
    // rows on For Posting: one per AIR (with its documents), one per document without an AIR
    post: can("post") ? new Set(postingItems().filter(i => !i.posting.posted).map(i => i.airId || `${i.kind}:${i.id}`)).size : 0,
    returned: S.d.airs.filter(a => a.endUserUid === S.user?.uid && a.status === "returned").length,
    drafts: S.d.airs.filter(a => a.endUserUid === S.user?.uid && a.status === "draft").length,
    pending: isAdmin() ? S.d.users.filter(u => u.status === "pending").length : 0,
    // the GSO: pre-repair inspections, post-repair inspections and posted repairs to verify
    repairs: can("issue") ? S.d.repairs.filter(r => r.fund === S.fund && ["requested", "repaired", "submitted", "posted"].includes(r.status)).length : 0,
    repairsReturned: S.d.repairs.filter(r => r.endUserUid === S.user?.uid && r.status === "returned").length
  };
  return c;
}

export const airRemainingLines = a => (a.lines || []).filter(l => remainingQty(l) > 0);

/** "Change number" for the GSO on a document dated 2026 (the changeover year). kind: "air" | "doc". */
export const canRenumber = d => can("issue") && String(d?.date || "").startsWith("2026-") && d.status !== "cancelled" && d.status !== "draft";
export async function renumberDialog(kind, d, label, current, btn) {
  const { confirmBox, busy } = await import("../ui.js"), { renumber } = await import("../data.js");
  const v = await confirmBox({ title: `Change ${label} No. ${current}`, body: "For documents dated 2026 only. The new number must be free in this fund; the old one is released, and the linked documents and property follow.",
    fields: [{ name: "number", label: `New ${label} No.`, required: true, value: current }, { name: "reason", label: "Reason", placeholder: "e.g. to match the printed form" }], confirmText: "Change number" });
  if (v) busy(btn, () => renumber(kind, d.id, v.number, v.reason || ""), `${label} No. changed to ${v.number.trim()}.`).catch(() => {});
}
