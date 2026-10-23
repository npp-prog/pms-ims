// Security-rules tests on the Firestore emulator (needs Java 11+):  npm run test:rules
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, runTransaction, addDoc } from "firebase/firestore";

let env;
const ctx = (uid, email = `${uid}@x.com`, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const USERS = {
  sa: { role: "superadmin", status: "active" }, ad: { role: "admin", status: "active" }, ad2: { role: "admin", status: "active" },
  gso: { role: "gso", status: "active" }, acc: { role: "accounting", status: "active" },
  eu: { role: "enduser", status: "active" }, eu2: { role: "enduser", status: "active" },
  pend: { role: "enduser", status: "pending" }, off: { role: "gso", status: "disabled" }
};
const line = (o = {}) => ({ id: "L1", description: "Laptop", unit: "unit", qty: 2, unitCost: 65000, amount: 130000, category: "ppe", accountCode: "10705030", issuedQty: 0, ...o });
const baseAir = (o = {}) => ({ fund: "GF", airNo: "2026-10-0001", date: "2026-10-01", office: "MHO", supplier: "ABC", endUserUid: "eu", status: "submitted", lines: [line()], total: 130000, history: [], ...o });
const baseDoc = (o = {}) => ({ docType: "par", number: "2026-10-0001", fund: "GF", airId: "A_APPR", airNo: "2026-10-0002", endUserUid: "eu", status: "issued", posting: { posted: false }, lines: [], total: 0, ...o });

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-pmsims", firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    for (const [uid, u] of Object.entries(USERS)) await setDoc(doc(d, `users/${uid}`), { uid, email: `${uid}@x.com`, displayName: uid, ...u });
    await setDoc(doc(d, "airs/A_SUB"), baseAir());
    await setDoc(doc(d, "airs/A_APPR"), baseAir({ airNo: "2026-10-0002", status: "approved", lines: [line(), line({ id: "L2", category: "cons", accountCode: "10404010", qty: 10, unitCost: 250, stockNo: "OS-1" })] }));
    await setDoc(doc(d, "airs/A_DRAFT"), baseAir({ airNo: "", status: "draft" }));
    await setDoc(doc(d, "airs/A_OTHER"), baseAir({ endUserUid: "eu2", airNo: "2026-10-0003" }));
    await setDoc(doc(d, "issuances/D1"), baseDoc());
    await setDoc(doc(d, "issuances/D_OTHER"), baseDoc({ endUserUid: "eu2", number: "2026-10-0009" }));
    await setDoc(doc(d, "counters/GF_AIR_2026-10"), { seq: 3 });
    await setDoc(doc(d, "settings/app"), { entityName: "Candoni" });
  });
});
after(async () => { await env?.cleanup(); });

test("signed-out users can read nothing", async () => {
  const d = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(d, "airs/A_SUB")));
  await assertFails(getDoc(doc(d, "settings/app")));
});

test("registration: only as a pending end-user; the designated email may claim Super Administrator", async () => {
  await assertSucceeds(setDoc(doc(ctx("new"), "users/new"), { uid: "new", email: "new@x.com", role: "enduser", status: "pending" }));
  await assertFails(setDoc(doc(ctx("new2"), "users/new2"), { uid: "new2", email: "new2@x.com", role: "gso", status: "pending" }));
  await assertFails(setDoc(doc(ctx("new3"), "users/new3"), { uid: "new3", email: "new3@x.com", role: "enduser", status: "active" }));
  await assertFails(setDoc(doc(ctx("new4"), "users/other"), { uid: "other", email: "new4@x.com", role: "enduser", status: "pending" }));
  await assertSucceeds(setDoc(doc(ctx("boss", "npp@mgocandoniaccounting.org"), "users/boss"), { uid: "boss", email: "npp@mgocandoniaccounting.org", role: "superadmin", status: "active" }));
  await assertFails(setDoc(doc(ctx("fake", "npp@mgocandoniaccounting.org", false), "users/fake"), { uid: "fake", email: "npp@mgocandoniaccounting.org", role: "superadmin", status: "active" }));
  await assertFails(setDoc(doc(ctx("x", "someone@x.com"), "users/x"), { uid: "x", email: "someone@x.com", role: "superadmin", status: "active" }));
});

test("users: pending users can't promote themselves; admins manage roles within their limits", async () => {
  await assertFails(updateDoc(doc(ctx("pend"), "users/pend"), { status: "active" }));
  await assertFails(updateDoc(doc(ctx("eu"), "users/eu"), { role: "gso" }));
  await assertSucceeds(updateDoc(doc(ctx("eu"), "users/eu"), { contact: "0917", updatedAt: 1 }));
  await assertFails(updateDoc(doc(ctx("eu"), "users/eu"), { office: "MTO", updatedAt: 1 }), "office is set by an administrator");
  await assertFails(getDoc(doc(ctx("eu"), "users/gso")));
  await assertSucceeds(getDocs(collection(ctx("ad"), "users")));
  await assertSucceeds(updateDoc(doc(ctx("ad"), "users/pend"), { role: "gso", status: "active" }));
  await assertFails(updateDoc(doc(ctx("ad"), "users/eu"), { role: "admin" }));
  await assertFails(updateDoc(doc(ctx("ad"), "users/ad2"), { status: "disabled" }));
  await assertFails(updateDoc(doc(ctx("ad"), "users/ad"), { role: "superadmin" }));
  await assertSucceeds(updateDoc(doc(ctx("sa"), "users/ad2"), { status: "disabled" }));
  await assertSucceeds(updateDoc(doc(ctx("sa"), "users/eu"), { role: "admin" }));
  await assertFails(updateDoc(doc(ctx("gso"), "users/pend"), { role: "gso", status: "active" }));
  await assertFails(deleteDoc(doc(ctx("sa"), "users/eu")));
});

test("end-users see only their own AIRs and documents", async () => {
  const d = ctx("eu");
  await assertSucceeds(getDocs(query(collection(d, "airs"), where("endUserUid", "==", "eu"))));
  await assertFails(getDocs(collection(d, "airs")));
  await assertFails(getDoc(doc(d, "airs/A_OTHER")));
  await assertSucceeds(getDocs(query(collection(d, "issuances"), where("endUserUid", "==", "eu"))));
  await assertFails(getDoc(doc(d, "issuances/D_OTHER")));
  await assertSucceeds(getDocs(collection(ctx("gso"), "airs")));
  await assertSucceeds(getDocs(collection(ctx("acc"), "issuances")));
  await assertFails(getDocs(query(collection(ctx("pend"), "airs"), where("endUserUid", "==", "pend"))));
  await assertFails(getDocs(collection(ctx("off"), "airs")));
});

test("end-user encodes, submits and edits only drafts or returned AIRs", async () => {
  const d = ctx("eu");
  await assertSucceeds(setDoc(doc(d, "airs/N1"), baseAir({ airNo: "", status: "draft" })));
  await assertFails(setDoc(doc(d, "airs/N2"), baseAir({ endUserUid: "eu2", airNo: "", status: "draft" })));
  await assertFails(setDoc(doc(d, "airs/N3"), baseAir({ status: "approved" })));
  await assertFails(setDoc(doc(d, "airs/N4"), baseAir({ airNo: "", status: "submitted" })));
  await assertFails(setDoc(doc(d, "airs/N5"), baseAir({ status: "submitted", inspection: { inspectedOk: true } })));
  await assertFails(setDoc(doc(d, "airs/N6"), baseAir({ fund: "XX", airNo: "", status: "draft" })));
  await assertSucceeds(updateDoc(doc(d, "airs/A_DRAFT"), { airNo: "2026-10-0004", status: "submitted" }));
  await assertFails(updateDoc(doc(d, "airs/A_SUB"), { supplier: "Changed" }));
  await assertFails(updateDoc(doc(d, "airs/A_APPR"), { status: "submitted" }));
  await assertFails(setDoc(doc(ctx("gso"), "airs/N7"), baseAir({ endUserUid: "gso", airNo: "", status: "draft" })));
});

test("a submitted or returned AIR keeps its number and fund", async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "airs/A_RET"), baseAir({ status: "returned" })));
  const d = ctx("eu");
  await assertFails(updateDoc(doc(d, "airs/A_RET"), { airNo: "2026-10-0099", status: "submitted" }));
  await assertFails(updateDoc(doc(d, "airs/A_RET"), { fund: "SEF", status: "submitted" }));
  await assertSucceeds(updateDoc(doc(d, "airs/A_RET"), { supplier: "Fixed", status: "submitted" }));
});

test("only the GSO (or admins) inspect, approve or return", async () => {
  const insp = { status: "approved", inspection: { inspectedOk: true }, acceptance: { status: "complete" } };
  await assertFails(updateDoc(doc(ctx("eu"), "airs/A_SUB"), insp));
  await assertFails(updateDoc(doc(ctx("acc"), "airs/A_SUB"), insp));
  await assertFails(updateDoc(doc(ctx("gso"), "airs/A_SUB"), { ...insp, supplier: "x" }));
  await assertSucceeds(updateDoc(doc(ctx("gso"), "airs/A_SUB"), insp));
  await assertFails(updateDoc(doc(ctx("gso"), "airs/A_DRAFT"), insp));
  await assertSucceeds(updateDoc(doc(ctx("ad"), "airs/A_OTHER"), { status: "returned", gsoRemarks: "Wrong PO" }));
});

test("GSO issues documents only from approved AIRs, in the same fund and for the AIR's end-user", async () => {
  const g = ctx("gso");
  await assertSucceeds(setDoc(doc(g, "issuances/N1"), baseDoc()));
  await assertFails(setDoc(doc(g, "issuances/N2"), baseDoc({ airId: "A_SUB" })));
  await assertFails(setDoc(doc(g, "issuances/N3"), baseDoc({ fund: "SEF" })));
  await assertFails(setDoc(doc(g, "issuances/N4"), baseDoc({ endUserUid: "eu2" })));
  await assertFails(setDoc(doc(g, "issuances/N5"), baseDoc({ posting: { posted: true } })));
  await assertFails(setDoc(doc(ctx("acc"), "issuances/N6"), baseDoc()));
  await assertFails(setDoc(doc(ctx("eu"), "issuances/N7"), baseDoc()));
  // the issuance + AIR quantity update run in one transaction
  await assertSucceeds(runTransaction(g, async tx => {
    const ref = doc(g, "airs/A_APPR"); const a = (await tx.get(ref)).data();
    tx.set(doc(g, "issuances/N8"), baseDoc({ docType: "ris", number: "2026-10-0005" }));
    tx.update(ref, { lines: a.lines.map(l => l.id === "L2" ? { ...l, issuedQty: 10 } : l), status: "approved", history: [] });
  }));
  await assertFails(updateDoc(doc(g, "airs/A_APPR"), { supplier: "x" }));
});

test("cancellation only before posting; accounting posts and unposts", async () => {
  await assertFails(updateDoc(doc(ctx("gso"), "issuances/D1"), { posting: { posted: true } }));
  await assertFails(updateDoc(doc(ctx("eu"), "issuances/D1"), { posting: { posted: true } }));
  await assertFails(updateDoc(doc(ctx("acc"), "issuances/D1"), { posting: { posted: true }, total: 1 }));
  await assertSucceeds(updateDoc(doc(ctx("acc"), "issuances/D1"), { posting: { posted: true, ref: "JEV-1", date: "2026-10-10" } }));
  await assertFails(updateDoc(doc(ctx("gso"), "issuances/D1"), { status: "cancelled", cancel: { reason: "x" } }));
  await assertSucceeds(updateDoc(doc(ctx("acc"), "issuances/D1"), { posting: { posted: false } }));
  await assertSucceeds(updateDoc(doc(ctx("gso"), "issuances/D1"), { status: "cancelled", cancel: { reason: "x" } }));
  await assertFails(updateDoc(doc(ctx("acc"), "issuances/D1"), { posting: { posted: true } }));
  await assertFails(deleteDoc(doc(ctx("sa"), "issuances/D1")));
  await assertSucceeds(updateDoc(doc(ctx("acc"), "airs/A_APPR"), { posting: { posted: true, ref: "JEV-2" } }));
  await assertFails(updateDoc(doc(ctx("acc"), "airs/A_SUB"), { posting: { posted: true, ref: "JEV-2" } }));
  await assertFails(updateDoc(doc(ctx("acc"), "airs/A_APPR"), { posting: { posted: true }, status: "issued" }));
});

test("counters only move forward by one", async () => {
  const d = ctx("eu");
  await assertSucceeds(updateDoc(doc(d, "counters/GF_AIR_2026-10"), { seq: 4 }));
  await assertFails(updateDoc(doc(d, "counters/GF_AIR_2026-10"), { seq: 9 }));
  await assertFails(updateDoc(doc(d, "counters/GF_AIR_2026-10"), { seq: 3 }));
  await assertSucceeds(setDoc(doc(d, "counters/GF_PAR_2026-11"), { seq: 1 }));
  await assertFails(setDoc(doc(d, "counters/GF_RIS_2026-11"), { seq: 5 }));
  await assertFails(setDoc(doc(ctx("pend"), "counters/GF_ICS_2026-11"), { seq: 1 }));
});

test("drafts deleted by their owner; settings and audit trail", async () => {
  await assertFails(deleteDoc(doc(ctx("eu"), "airs/A_SUB")));
  await assertFails(deleteDoc(doc(ctx("eu2"), "airs/A_DRAFT")));
  await assertSucceeds(deleteDoc(doc(ctx("eu"), "airs/A_DRAFT")));
  await assertFails(deleteDoc(doc(ctx("ad"), "airs/A_APPR")));
  await assertSucceeds(getDoc(doc(ctx("pend"), "settings/app")));
  await assertFails(setDoc(doc(ctx("gso"), "settings/app"), { entityName: "x" }));
  await assertSucceeds(setDoc(doc(ctx("ad"), "settings/app"), { entityName: "x" }, { merge: true }));
  await assertSucceeds(addDoc(collection(ctx("gso"), "auditLogs"), { uid: "gso", action: "x" }));
  await assertFails(addDoc(collection(ctx("gso"), "auditLogs"), { uid: "someone", action: "x" }));
  await assertFails(getDocs(collection(ctx("gso"), "auditLogs")));
  await assertSucceeds(getDocs(collection(ctx("ad"), "auditLogs")));
});

const asset = (o = {}) => ({ fund: "GF", itemType: "ppe", accountCode: "10705030", cost: 60000, qty: 1, status: "active", custodianUid: "eu", holder: { name: "eu" }, source: { kind: "par" }, history: [], ...o });

test("user directory: GSO and Accounting can read it, End-Users can't", async () => {
  await assertSucceeds(getDocs(collection(ctx("gso"), "users")));
  await assertSucceeds(getDocs(collection(ctx("acc"), "users")));
  await assertFails(getDocs(collection(ctx("eu"), "users")));
  await assertFails(updateDoc(doc(ctx("gso"), "users/eu"), { role: "gso" }));
});

test("property records: who creates, who changes what, who reads", async () => {
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await setDoc(doc(d, "assets/P1"), asset());
    await setDoc(doc(d, "assets/P2"), asset({ custodianUid: "eu2" }));
  });
  await assertSucceeds(setDoc(doc(ctx("gso"), "assets/N1"), asset()));
  await assertFails(setDoc(doc(ctx("acc"), "assets/N2"), asset()));
  await assertFails(setDoc(doc(ctx("eu"), "assets/N3"), asset()));
  await assertFails(setDoc(doc(ctx("gso"), "assets/N4"), asset({ cost: -1 })));
  await assertSucceeds(setDoc(doc(ctx("ad"), "assets/N5"), asset({ source: { kind: "import" } })));
  // reading
  await assertSucceeds(getDocs(query(collection(ctx("eu"), "assets"), where("custodianUid", "==", "eu"))));
  await assertFails(getDoc(doc(ctx("eu"), "assets/P2")));
  await assertSucceeds(getDocs(collection(ctx("acc"), "assets")));
  // changing
  await assertSucceeds(updateDoc(doc(ctx("gso"), "assets/P1"), { holder: { name: "Jose" }, custodianUid: "", status: "active" }));
  await assertFails(updateDoc(doc(ctx("gso"), "assets/P1"), { accountCode: "10705020" }));
  await assertFails(updateDoc(doc(ctx("gso"), "assets/P1"), { fund: "SEF" }));
  await assertFails(updateDoc(doc(ctx("gso"), "assets/P1"), { status: "stolen" }));
  await assertSucceeds(updateDoc(doc(ctx("acc"), "assets/P1"), { usefulLifeYears: 7, residualValue: 3000 }));
  await assertFails(updateDoc(doc(ctx("acc"), "assets/P1"), { holder: { name: "x" } }));
  await assertFails(updateDoc(doc(ctx("eu"), "assets/P1"), { condition: "Unserviceable" }));
  await assertFails(deleteDoc(doc(ctx("sa"), "assets/P1")));
});

test("transfers, returns, disposals", async () => {
  const mv = (o = {}) => ({ docType: "dsp", fund: "GF", status: "done", needsPosting: true, posting: { posted: false }, lines: [], ...o });
  await assertSucceeds(setDoc(doc(ctx("gso"), "movements/M1"), mv()));
  await assertSucceeds(setDoc(doc(ctx("gso"), "movements/M2"), mv({ docType: "ptr", needsPosting: false })));
  await assertFails(setDoc(doc(ctx("acc"), "movements/M3"), mv()));
  await assertFails(setDoc(doc(ctx("gso"), "movements/M4"), mv({ docType: "xyz" })));
  await assertFails(setDoc(doc(ctx("gso"), "movements/M5"), mv({ posting: { posted: true } })));
  await assertFails(updateDoc(doc(ctx("acc"), "movements/M2"), { posting: { posted: true } }), "transfers aren't posted");
  await assertSucceeds(updateDoc(doc(ctx("acc"), "movements/M1"), { posting: { posted: true, ref: "JEV-9" } }));
  await assertFails(updateDoc(doc(ctx("gso"), "movements/M1"), { status: "cancelled", cancel: {} }), "posted: can't cancel");
  await assertFails(getDocs(collection(ctx("eu"), "movements")));
});

test("depreciation and Trial Balance belong to Accounting", async () => {
  const run = { fund: "GF", period: "2026-01", amounts: { P1: 950 }, total: 950 };
  await assertFails(setDoc(doc(ctx("gso"), "depreciation/GF_2026-01"), run));
  await assertFails(setDoc(doc(ctx("acc"), "depreciation/SEF_2026-01"), run), "id must match fund and period");
  await assertFails(setDoc(doc(ctx("acc"), "depreciation/GF_2026-1"), { ...run, period: "2026-1" }));
  await assertSucceeds(setDoc(doc(ctx("acc"), "depreciation/GF_2026-01"), run));
  await assertFails(updateDoc(doc(ctx("acc"), "depreciation/GF_2026-01"), { total: 1 }));
  await assertSucceeds(getDocs(collection(ctx("gso"), "depreciation")));
  await assertFails(deleteDoc(doc(ctx("gso"), "depreciation/GF_2026-01")));
  await assertSucceeds(deleteDoc(doc(ctx("acc"), "depreciation/GF_2026-01")));
  const tb = { fund: "GF", period: "2025-12", accounts: { "10705020": { debit: 1, credit: 0 } } };
  await assertSucceeds(setDoc(doc(ctx("acc"), "tbSnapshots/GF_2025-12"), tb));
  await assertFails(setDoc(doc(ctx("gso"), "tbSnapshots/GF_2025-12"), tb));
  await assertSucceeds(getDoc(doc(ctx("gso"), "tbSnapshots/GF_2025-12")));
  await assertFails(getDoc(doc(ctx("eu"), "tbSnapshots/GF_2025-12")));
});

test("only administrators import the IMS beginning balance", async () => {
  const bb = baseAir({ airNo: "BB-2026-01-01", status: "approved", imported: true, endUserUid: "ad", posting: { posted: true } });
  await assertSucceeds(setDoc(doc(ctx("ad"), "airs/BB1"), bb));
  await assertFails(setDoc(doc(ctx("gso"), "airs/BB2"), { ...bb, endUserUid: "gso" }));
  await assertFails(setDoc(doc(ctx("eu"), "airs/BB3"), { ...bb, endUserUid: "eu" }));
});

test("Construction in Progress and SWA", async () => {
  const proj = { fund: "GF", accountCode: "10710030", cipNo: "C1", status: "in_progress", billings: [] };
  await assertSucceeds(setDoc(doc(ctx("acc"), "cipProjects/C1"), proj));
  await assertFails(setDoc(doc(ctx("gso"), "cipProjects/C2"), proj));
  await assertFails(setDoc(doc(ctx("acc"), "cipProjects/C3"), { ...proj, accountCode: "10705020" }));
  await assertSucceeds(getDoc(doc(ctx("gso"), "cipProjects/C1")));
  await assertFails(getDoc(doc(ctx("eu"), "cipProjects/C1")));
  await assertSucceeds(updateDoc(doc(ctx("acc"), "cipProjects/C1"), { billings: [{ id: "b1", byContract: 5 }] }));
  await assertFails(updateDoc(doc(ctx("acc"), "cipProjects/C1"), { fund: "SEF" }));
  await assertFails(deleteDoc(doc(ctx("acc"), "cipProjects/C1")), "has billings");
  // SWA: GSO or Accounting encode; only Accounting matches; a matched SWA is locked
  await assertSucceeds(setDoc(doc(ctx("gso"), "swa/S1"), { fund: "GF", swaNo: "SWA-1", matched: false }));
  await assertFails(setDoc(doc(ctx("eu"), "swa/S2"), { fund: "GF", swaNo: "SWA-2", matched: false }));
  await assertFails(updateDoc(doc(ctx("gso"), "swa/S1"), { matched: true, matchedProjectId: "C1" }));
  await assertSucceeds(updateDoc(doc(ctx("acc"), "swa/S1"), { matched: true, matchedProjectId: "C1", matchedBillingId: "b1" }));
  await assertFails(updateDoc(doc(ctx("gso"), "swa/S1"), { cost: 1 }), "matched: locked");
  await assertFails(deleteDoc(doc(ctx("acc"), "swa/S1")), "matched: can't delete");
  // completing: Accounting creates the PPE record and closes the project in one transaction
  const a = ctx("acc");
  await assertSucceeds(runTransaction(a, async tx => {
    await tx.get(doc(a, "cipProjects/C1"));
    tx.set(doc(a, "assets/FROMCIP"), asset({ source: { kind: "cip", docId: "C1" }, custodianUid: "" }));
    tx.update(doc(a, "cipProjects/C1"), { status: "completed", completed: { assetId: "FROMCIP" } });
  }));
  await assertFails(setDoc(doc(a, "assets/FAKE"), asset({ source: { kind: "cip", docId: "C1" } })), "only the record named in the completion");
  await assertFails(updateDoc(doc(a, "cipProjects/C1"), { name: "x" }), "a transferred project is closed");
  await assertFails(setDoc(doc(ctx("acc"), "assets/NOCIP"), asset({ source: { kind: "par" } })), "Accounting can't create other property");
});

test("History of Repair: End-Users record repairs of their own property; the GSO verifies", async () => {
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await setDoc(doc(d, "assets/MINE"), asset({ custodianUid: "eu" }));
    await setDoc(doc(d, "assets/OTHERS"), asset({ custodianUid: "eu2" }));
  });
  const rep = (o = {}) => ({ fund: "GF", assetId: "MINE", endUserUid: "eu", status: "submitted", jobOrderNo: "JO-1", parts: [], totalCost: 100, ...o });
  const e = ctx("eu");
  await assertSucceeds(setDoc(doc(e, "repairs/R1"), rep()));
  await assertFails(setDoc(doc(e, "repairs/R2"), rep({ assetId: "OTHERS" })), "not their property");
  await assertFails(setDoc(doc(e, "repairs/R3"), rep({ endUserUid: "eu2" })));
  await assertFails(setDoc(doc(e, "repairs/R4"), rep({ status: "verified" })));
  await assertFails(setDoc(doc(ctx("pend"), "repairs/R5"), rep({ endUserUid: "pend" })));
  await assertSucceeds(setDoc(doc(ctx("gso"), "repairs/R6"), rep({ assetId: "OTHERS", endUserUid: "eu2" })), "the GSO records for anyone");
  await assertSucceeds(getDocs(query(collection(e, "repairs"), where("endUserUid", "==", "eu"))));
  await assertFails(getDoc(doc(e, "repairs/R6")));
  await assertSucceeds(updateDoc(doc(e, "repairs/R1"), { totalCost: 120 }));
  await assertFails(updateDoc(doc(e, "repairs/R1"), { status: "verified" }), "can't verify their own");
  await assertFails(updateDoc(doc(ctx("gso"), "repairs/R1"), { status: "verified", totalCost: 1 }), "verification changes nothing else");
  await assertSucceeds(updateDoc(doc(ctx("gso"), "repairs/R1"), { status: "verified", verifiedBy: { name: "Ramon" } }));
  await assertFails(updateDoc(doc(e, "repairs/R1"), { totalCost: 5, status: "submitted" }), "verified: locked");
  await assertFails(deleteDoc(doc(e, "repairs/R1")));
  await assertSucceeds(updateDoc(doc(ctx("gso"), "repairs/R6"), { status: "returned", gsoRemarks: "Attach JO" }));
  await assertSucceeds(updateDoc(doc(ctx("gso"), "repairs/R6"), { status: "submitted", totalCost: 99 }), "corrected and resent");
});

test("End-Users see the property and PAR/ICS/RIS of their own office, not other offices'", async () => {
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await updateDoc(doc(d, "users/eu"), { office: "Municipal Health Office" });
    await updateDoc(doc(d, "users/eu2"), { office: "Municipal Agriculture Office" });
    await setDoc(doc(d, "assets/MHO1"), asset({ custodianUid: "someone", holder: { name: "Dr. Cruz", office: "Municipal Health Office" } }));
    await setDoc(doc(d, "assets/AGRI1"), asset({ custodianUid: "someone", holder: { name: "Juan", office: "Municipal Agriculture Office" } }));
    await setDoc(doc(d, "assets/NOOFF"), asset({ custodianUid: "", holder: { name: "", office: "" } }));
    await setDoc(doc(d, "issuances/OFF1"), baseDoc({ endUserUid: "x", recipient: { name: "Dr. Cruz", office: "Municipal Health Office" } }));
  });
  const e = ctx("eu");
  await assertSucceeds(getDocs(query(collection(e, "assets"), where("holder.office", "==", "Municipal Health Office"))));
  await assertSucceeds(getDoc(doc(e, "assets/MHO1")));
  await assertFails(getDoc(doc(e, "assets/AGRI1")));
  await assertFails(getDocs(query(collection(e, "assets"), where("holder.office", "==", "Municipal Agriculture Office"))));
  await assertFails(getDoc(doc(e, "assets/NOOFF")), "an item with no office is not everyone's");
  await assertSucceeds(getDocs(query(collection(e, "issuances"), where("recipient.office", "==", "Municipal Health Office"))));
  await assertFails(getDoc(doc(ctx("eu2"), "issuances/OFF1")));
  await assertFails(getDocs(query(collection(ctx("pend"), "assets"), where("holder.office", "==", ""))));
  // the office decides what they see, so only an administrator changes it
  await assertFails(updateDoc(doc(e, "users/eu"), { office: "Municipal Agriculture Office" }));
  await assertSucceeds(updateDoc(doc(e, "users/eu"), { position: "Nurse III" }));
  await assertSucceeds(updateDoc(doc(ctx("ad"), "users/eu"), { office: "Municipal Agriculture Office" }));
  await assertSucceeds(getDoc(doc(e, "assets/AGRI1")), "after the administrator moved her");
  await assertFails(getDoc(doc(e, "assets/MHO1")));
});

test("PMS register maintenance: manual items, revaluation, ledger entries, reclassification, reactivation", async () => {
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await setDoc(doc(d, "assets/P1"), asset());
    await setDoc(doc(d, "assets/PX"), asset({ status: "disposed", disposal: { reason: "Lost" } }));
  });
  // Accounting (and the GSO) add items by hand; Accounting can't pretend they came from a PAR
  await assertSucceeds(setDoc(doc(ctx("acc"), "assets/M1"), asset({ source: { kind: "manual" } })));
  await assertSucceeds(setDoc(doc(ctx("gso"), "assets/M2"), asset({ source: { kind: "manual" } })));
  await assertFails(setDoc(doc(ctx("acc"), "assets/M3"), asset({ source: { kind: "par" } })));
  await assertFails(setDoc(doc(ctx("eu"), "assets/M4"), asset({ source: { kind: "manual" } })));
  // Accounting: revalue, ledger entries, reclassify, fund transfer
  await assertSucceeds(updateDoc(doc(ctx("acc"), "assets/P1"), { cost: 70000, residualValue: 3500, revaluations: [{ date: "2026-10-01", oldCost: 60000, newCost: 70000 }] }));
  await assertSucceeds(updateDoc(doc(ctx("acc"), "assets/P1"), { adjustments: [{ type: "impairment", amount: 1000 }] }));
  await assertSucceeds(updateDoc(doc(ctx("acc"), "assets/P1"), { accountCode: "10705020", accountChanges: [{ oldCode: "10705030", newCode: "10705020" }], fund: "SEF", fundChanges: [{ oldFund: "GF", newFund: "SEF" }] }));
  await assertFails(updateDoc(doc(ctx("acc"), "assets/P1"), { fund: "XYZ" }), "only real funds");
  await assertFails(updateDoc(doc(ctx("acc"), "assets/P1"), { itemType: "sx" }), "PPE stays PPE");
  await assertFails(updateDoc(doc(ctx("acc"), "assets/P1"), { status: "disposed" }), "Accounting doesn't dispose; the GSO does on a disposal report");
  // the GSO keeps custody, but not the ledger side
  await assertFails(updateDoc(doc(ctx("gso"), "assets/P1"), { revaluations: [] }));
  await assertFails(updateDoc(doc(ctx("gso"), "assets/P1"), { adjustments: [] }));
  await assertSucceeds(updateDoc(doc(ctx("gso"), "assets/P1"), { special: { lotId: "L-1" }, remarks: "ok", parIcs: { docType: "par", number: "2026-10-0002" } }));
  // reactivation: disposed → active only
  await assertSucceeds(updateDoc(doc(ctx("acc"), "assets/PX"), { status: "active", disposal: null, reactivations: [{ reason: "found" }] }));
  await assertFails(updateDoc(doc(ctx("acc"), "assets/P1"), { status: "returned" }));
});

test("PAR / ICS for register items, editing a transfer's printed details, depreciation override", async () => {
  const reg = baseDoc({ airId: null, airNo: "", origin: "register", number: "2026-10-0005" });
  await assertSucceeds(setDoc(doc(ctx("gso"), "issuances/R1"), reg));
  await assertFails(setDoc(doc(ctx("gso"), "issuances/R2"), { ...reg, docType: "ris" }), "RIS always comes from an AIR");
  await assertFails(setDoc(doc(ctx("gso"), "issuances/R3"), { ...reg, origin: "", airId: "A_SUB" }), "otherwise the AIR must be approved");
  await assertFails(setDoc(doc(ctx("acc"), "issuances/R4"), reg));
  const mv = { docType: "ptr", fund: "GF", status: "done", needsPosting: false, posting: { posted: false }, lines: [{ assetId: "P1" }], reason: "old" };
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "movements/T1"), mv); });
  await assertSucceeds(updateDoc(doc(ctx("gso"), "movements/T1"), { reason: "Reassigned to MEO", approvedBy: { name: "Mayor" } }));
  await assertFails(updateDoc(doc(ctx("gso"), "movements/T1"), { lines: [] }), "the items don't change");
  await assertFails(updateDoc(doc(ctx("acc"), "movements/T1"), { reason: "x" }));
  const run = { fund: "GF", period: "2026-02", amounts: { P1: 950 }, total: 950, override: { reason: "TB late" } };
  await assertFails(setDoc(doc(ctx("acc"), "depreciation/GF_2026-02"), run), "only an administrator overrides the Trial Balance gate");
  await assertSucceeds(setDoc(doc(ctx("ad"), "depreciation/GF_2026-02"), run));
});

test("End-Users see the submitted AIRs of their office, never a colleague's draft, and edit only their own", async () => {
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await updateDoc(doc(d, "users/eu"), { office: "MHO" });
    await updateDoc(doc(d, "users/eu2"), { office: "MHO" });
    await setDoc(doc(d, "airs/COL_SUB"), baseAir({ endUserUid: "eu2", office: "MHO", airNo: "2026-10-0010" }));
    await setDoc(doc(d, "airs/COL_DRAFT"), baseAir({ endUserUid: "eu2", office: "MHO", airNo: "", status: "draft" }));
    await setDoc(doc(d, "airs/OTHER_OFF"), baseAir({ endUserUid: "x", office: "MAO", airNo: "2026-10-0011" }));
  });
  const e = ctx("eu");
  await assertSucceeds(getDocs(query(collection(e, "airs"), where("office", "==", "MHO"), where("status", "in", ["submitted", "returned", "approved", "issued"]))));
  await assertSucceeds(getDoc(doc(e, "airs/COL_SUB")));
  await assertFails(getDoc(doc(e, "airs/COL_DRAFT")), "a colleague's draft stays private");
  await assertFails(getDocs(query(collection(e, "airs"), where("office", "==", "MHO"))), "the query must leave drafts out");
  await assertFails(getDoc(doc(e, "airs/OTHER_OFF")));
  await assertFails(updateDoc(doc(e, "airs/COL_SUB"), { supplier: "x" }), "only the encoder edits");
});

test("numbering: series start at 1 or at the administrator's starting number; numbers are claimed once; admins set the next number", async () => {
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "settings/app"), { entityName: "Candoni", numbering: { par: { start: 151 } } }); });
  const g = ctx("gso");
  await assertSucceeds(setDoc(doc(g, "counters/GF_PAR_2026-12"), { seq: 151, type: "par" }));
  await assertFails(setDoc(doc(g, "counters/GF_RIS_2026-12"), { seq: 151, type: "ris" }), "RIS has no starting number set");
  await assertSucceeds(setDoc(doc(g, "counters/GF_RIS_2026-12"), { seq: 1, type: "ris" }));
  await assertFails(updateDoc(doc(g, "counters/GF_PAR_2026-12"), { seq: 200 }));
  await assertSucceeds(updateDoc(doc(ctx("ad"), "counters/GF_PAR_2026-12"), { seq: 199 }), "an administrator sets the next number");
  await assertSucceeds(setDoc(doc(ctx("ad"), "counters/GF_AIR_2027"), { seq: 0 }));
  await assertSucceeds(setDoc(doc(g, "docNumbers/GF_par_2026-12-0151"), { number: "2026-12-0151", by: "gso" }));
  await assertFails(setDoc(doc(g, "docNumbers/GF_par_2026-12-0151"), { number: "2026-12-0151", by: "gso" }), "a number is used once");
  await assertFails(deleteDoc(doc(ctx("ad"), "docNumbers/GF_par_2026-12-0151")));
  await assertFails(setDoc(doc(ctx("pend"), "docNumbers/GF_air_X"), { number: "X", by: "pend" }));
});

test("users brought over from PMS: invited by an administrator, activated with exactly that role and office", async () => {
  const inv = { email: "liza@pms.ph", role: "accounting", office: "Municipal Accounting Office", displayName: "Liza" };
  await assertFails(setDoc(doc(ctx("gso"), "invites/liza@pms.ph"), inv));
  await assertSucceeds(setDoc(doc(ctx("ad"), "invites/liza@pms.ph"), inv));
  await assertFails(setDoc(doc(ctx("ad"), "invites/boss@pms.ph"), { ...inv, email: "boss@pms.ph", role: "admin" }), "only the Super Administrator invites an Admin");
  await assertSucceeds(setDoc(doc(ctx("sa"), "invites/boss@pms.ph"), { ...inv, email: "boss@pms.ph", role: "admin" }));
  await assertFails(setDoc(doc(ctx("sa"), "invites/x@pms.ph"), { ...inv, email: "x@pms.ph", role: "superadmin" }));
  const user = (uid, o = {}) => ({ uid, email: "liza@pms.ph", role: "accounting", status: "active", office: "Municipal Accounting Office", ...o });
  // the invited person, with a verified email
  const liza = env.authenticatedContext("liza", { email: "liza@pms.ph", email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(liza, "invites/liza@pms.ph")));
  await assertFails(setDoc(doc(liza, "users/liza"), user("liza", { role: "admin" })), "not a role they weren't given");
  await assertFails(setDoc(doc(liza, "users/liza"), user("liza", { office: "Municipal Health Office" })), "not another office");
  const unverified = env.authenticatedContext("liza2", { email: "liza@pms.ph", email_verified: false }).firestore();
  await assertFails(setDoc(doc(unverified, "users/liza2"), user("liza2")), "an unconfirmed email can't claim it");
  await assertSucceeds(setDoc(doc(liza, "users/liza"), user("liza")));
  await assertSucceeds(updateDoc(doc(liza, "invites/liza@pms.ph"), { acceptedUid: "liza", acceptedAt: 1 }));
  await assertFails(updateDoc(doc(liza, "invites/liza@pms.ph"), { role: "admin" }));
  // someone else can't read or use it
  const other = env.authenticatedContext("o", { email: "other@pms.ph", email_verified: true }).firestore();
  await assertFails(getDoc(doc(other, "invites/liza@pms.ph")));
  await assertFails(setDoc(doc(other, "users/o"), { ...user("o"), email: "other@pms.ph" }));
});
