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
    repairs: can("issue") ? S.d.repairs.filter(r => r.fund === S.fund && r.status === "submitted").length : 0,
    repairsReturned: S.d.repairs.filter(r => r.endUserUid === S.user?.uid && r.status === "returned").length
  };
  return c;
}

export const airRemainingLines = a => (a.lines || []).filter(l => remainingQty(l) > 0);
