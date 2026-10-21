// Small pieces shared by several screens: work-queue counts and the "posting items" of the fund.
import { S, fundAirs, fundDocs, can, isAdmin } from "../state.js";
import { remainingQty } from "../core/logic.js";

/** Accounting's to-do list: supply receipts on approved AIRs and every live PAR/ICS/RIS. */
export function postingItems() {
  const items = [];
  for (const a of fundAirs()) if (["approved", "issued"].includes(a.status) && (a.lines || []).some(l => l.category === "cons"))
    items.push({ kind: "air", id: a.id, label: "AIR receipt (supplies)", number: a.airNo, date: a.acceptance?.dateReceived || a.date, airId: a.id, airNo: a.airNo, office: a.office,
      amount: (a.lines || []).filter(l => l.category === "cons").reduce((t, l) => t + (Number(l.amount) || 0), 0), posting: a.posting || { posted: false } });
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
    post: can("post") ? postingItems().filter(i => !i.posting.posted).length : 0,
    returned: S.d.airs.filter(a => a.endUserUid === S.user?.uid && a.status === "returned").length,
    drafts: S.d.airs.filter(a => a.endUserUid === S.user?.uid && a.status === "draft").length,
    pending: isAdmin() ? S.d.users.filter(u => u.status === "pending").length : 0
  };
  return c;
}

export const airRemainingLines = a => (a.lines || []).filter(l => remainingQty(l) > 0);
