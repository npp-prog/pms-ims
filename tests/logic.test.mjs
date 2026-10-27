// Business-rule tests (no Firebase needed):  npm run test:logic
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  round2, lineAmount, linesTotal, suggestCategory, sxClass, counterKey, formatNumber, remainingQty, statusAfterIssue,
  postingSummary, validateAir, validateInspection, checkIssue, stockCards, rsmi
} from "../public/js/core/logic.js";
import { accountCategory, isDistributionAccount, SUPERADMIN_EMAILS, applyChartOfAccounts, checkChartAccount, accountName, ppeAccount, isSxAccount, accountByCodeOrName, PPE_ACCOUNTS } from "../public/js/core/catalog.js";
import { readFileSync } from "node:fs";

test("money is rounded to the centavo", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1.005), 1.01);
  assert.equal(lineAmount({ qty: 3, unitCost: 33.333 }), 100);
  assert.equal(linesTotal([{ qty: 2, unitCost: 10.25 }, { qty: 1, unitCost: 0.1 }]), 20.6);
});

test("classification follows the ₱50,000 / ₱5,000 thresholds", () => {
  assert.equal(suggestCategory("equipment", 50000), "ppe");
  assert.equal(suggestCategory("equipment", 49999.99), "sx");
  assert.equal(suggestCategory("supplies", 90000), "cons");
  assert.equal(sxClass(5000), "low");
  assert.equal(sxClass(5000.01), "high");
  assert.equal(suggestCategory("equipment", 60000, { capitalization: 75000, sxHighValue: 5000 }), "sx");
});

test("document numbers follow the PMS / IMS formats", () => {
  const air = counterKey("GF", "air", "2026-10-21");
  assert.deepEqual(air, { key: "GF_AIR_2026-10", ym: "2026-10", prefix: "AIR" });
  assert.equal(formatNumber("air", air.ym, air.prefix, 7), "2026-10-0007");
  const ics = counterKey("SEF", "ics", "2026-05-02", "low");
  assert.equal(ics.key, "SEF_SPLV_2026-05");
  assert.equal(formatNumber("ics", ics.ym, ics.prefix, 27), "SPLV-2026-05-0027");
  assert.equal(formatNumber("ics", "2026-05", counterKey("GF", "ics", "2026-05-02", "high").prefix, 1), "SPHV-2026-05-0001");
  assert.throws(() => counterKey("GF", "par", ""));
});

test("AIR validation", () => {
  const ok = { fund: "GF", date: "2026-10-01", supplier: "ABC", office: "MHO", lines: [{ description: "Bond paper", unit: "ream", qty: 10, unitCost: 250 }] };
  assert.deepEqual(validateAir(ok), []);
  assert.match(validateAir({ ...ok, lines: [] })[0], /at least one item/);
  assert.match(validateAir({ ...ok, lines: [{ description: "x", unit: "pc", qty: 0, unitCost: 1 }] })[0], /quantity/);
  assert.match(validateAir({ ...ok, lines: [{ description: "x", unit: "pc", qty: 1, unitCost: "" }] })[0], /unit cost/);
  const insp = { inspection: { dateInspected: "2026-10-02", inspectedOk: true }, acceptance: { dateReceived: "2026-10-02", status: "complete" },
    lines: [{ category: "cons", accountCode: "10404010", stockNo: "OS-1" }] };
  assert.deepEqual(validateInspection(insp), []);
  assert.match(validateInspection({ ...insp, lines: [{ category: "cons", accountCode: "10404010" }] })[0], /stock number/);
  assert.match(validateInspection({ ...insp, acceptance: { dateReceived: "2026-10-02", status: "partial" } })[0], /partially/);
});

const air = {
  id: "A1", fund: "GF", airNo: "2026-10-0001", date: "2026-10-01", status: "approved", office: "MHO",
  acceptance: { dateReceived: "2026-10-02" },
  lines: [
    { id: "L1", description: "Laptop", unit: "unit", qty: 2, unitCost: 65000, amount: 130000, category: "ppe", accountCode: "10705030", issuedQty: 0 },
    { id: "L2", description: "Chair", unit: "pc", qty: 4, unitCost: 3500, amount: 14000, category: "sx", accountCode: "10406010", issuedQty: 0 },
    { id: "L3", description: "Monitor", unit: "unit", qty: 1, unitCost: 8000, amount: 8000, category: "sx", accountCode: "10405030", issuedQty: 0 },
    { id: "L4", description: "Bond paper", unit: "ream", qty: 10, unitCost: 250, amount: 2500, category: "cons", accountCode: "10404010", stockNo: "OS-1", issuedQty: 0 }
  ]
};

test("issuance is checked against what is left on the AIR", () => {
  assert.deepEqual(checkIssue(air, "par", [{ lineId: "L1", qty: 1 }]).errors, []);
  assert.match(checkIssue(air, "par", [{ lineId: "L1", qty: 3 }]).errors[0], /only 2/);
  assert.match(checkIssue(air, "par", [{ lineId: "L2", qty: 1 }]).errors[0], /not PAR/);
  assert.match(checkIssue(air, "ics", [{ lineId: "L2", qty: 1.5 }]).errors[0], /whole units/);
  assert.deepEqual(checkIssue(air, "ris", [{ lineId: "L4", qty: 2.5 }]).errors, []);
  assert.match(checkIssue({ ...air, status: "submitted" }, "ris", [{ lineId: "L4", qty: 1 }]).errors[0], /approved/);
  assert.match(checkIssue(air, "ris", []).errors[0], /at least one/);
});

test("AIR is fully issued only when every line is covered", () => {
  assert.equal(statusAfterIssue(air.lines), "approved");
  assert.equal(remainingQty({ qty: 10, issuedQty: 2.5 }), 7.5);
  assert.equal(statusAfterIssue(air.lines.map(l => ({ ...l, issuedQty: l.qty }))), "issued");
});

test("posting summary covers the supply receipt and every live document", () => {
  const issued = { ...air, lines: air.lines.map(l => ({ ...l, issuedQty: l.qty })), status: "issued" };
  const docs = [
    { airId: "A1", docType: "par", status: "issued", posting: { posted: true } },
    { airId: "A1", docType: "ics", status: "issued", posting: { posted: false } },
    { airId: "A1", docType: "ris", status: "cancelled", posting: { posted: false } }
  ];
  assert.deepEqual(postingSummary(issued, docs), { total: 3, posted: 1, state: "partial", unissued: false });
  const all = postingSummary({ ...issued, posting: { posted: true } }, docs.map(d => ({ ...d, posting: { posted: true } })));
  assert.equal(all.state, "posted");
  assert.equal(postingSummary({ ...air, lines: [air.lines[0]] }, []).state, "unposted", "the AIR itself is posted first");
  // everything issued so far is posted, but PPE is still waiting to be issued -> partial
  assert.equal(postingSummary({ ...air, lines: [air.lines[0]] }, [{ airId: "A1", docType: "par", status: "issued", posting: { posted: true } }]).state, "partial");
});

test("stock cards and RSMI use the exact cost of each AIR line", () => {
  const air2 = { ...air, id: "A2", airNo: "2026-10-0002", date: "2026-10-05", acceptance: { dateReceived: "2026-10-05" }, lines: [{ ...air.lines[3], id: "L9", qty: 4, unitCost: 260 }] };
  const docs = [
    { fund: "GF", docType: "ris", status: "issued", number: "2026-10-0001", date: "2026-10-03", recipient: { office: "MHO" }, posting: { posted: true }, lines: [{ stockNo: "OS-1", description: "Bond paper", unit: "ream", qty: 6, unitCost: 250, amount: 1500, accountCode: "10404010" }] },
    { fund: "GF", docType: "ris", status: "issued", number: "2026-10-0002", date: "2026-10-06", recipient: { office: "MTO" }, posting: { posted: true }, lines: [{ stockNo: "OS-1", description: "Bond paper", unit: "ream", qty: 4, unitCost: 260, amount: 1040, accountCode: "10404010" }] },
    { fund: "GF", docType: "ris", status: "cancelled", number: "2026-10-0003", date: "2026-10-06", lines: [{ stockNo: "OS-1", qty: 99, unitCost: 1 }] }
  ];
  const posted = { posted: true, date: "2026-10-05", ref: "JEV-1" };
  const [card] = stockCards([{ ...air, posting: posted }, { ...air2, posting: posted }, { ...air, id: "X", status: "submitted" }], docs, "GF");
  // supplies enter the Inventory Registry only when Accounting posts the AIR
  assert.equal(stockCards([air, air2], [], "GF").length, 0);
  assert.equal(stockCards([air, air2], [], "GF", "", { postedOnly: false })[0].balQty, 14);
  // an RIS issued but not posted is a reserve, not a deduction; once posted it is deducted
  const early = [{ fund: "GF", docType: "ris", status: "issued", airId: air.id, number: "R9", date: "2026-10-02", lines: [{ stockNo: "OS-1", qty: 2, unitCost: 250 }] }];
  assert.equal(stockCards([air], early, "GF").length, 0);
  const [res] = stockCards([{ ...air, posting: posted }], early, "GF");
  assert.deepEqual([res.balQty, res.reserved, res.available], [10, 2, 8]);
  const [ded] = stockCards([{ ...air, posting: posted }], [{ ...early[0], posting: posted }], "GF");
  assert.deepEqual([ded.balQty, ded.reserved, ded.available], [8, 0, 8]);
  assert.equal(card.stockNo, "OS-1");
  assert.equal(card.balQty, 4);
  assert.equal(card.balValue, round2(2500 + 1040 - 1500 - 1040));
  assert.deepEqual(card.moves.map(m => m.ref), ["AIR 2026-10-0001", "RIS 2026-10-0001", "AIR 2026-10-0002", "RIS 2026-10-0002"]);
  const r = rsmi(docs, "GF", "2026-10-01", "2026-10-31");
  assert.equal(r.lines.length, 2);
  assert.equal(r.total, 2540);
  assert.equal(r.recap.length, 2);
  assert.equal(rsmi(docs, "GF", "2026-10-04", "2026-10-31").total, 1040);
});

test("catalog helpers", () => {
  assert.equal(accountCategory("10705030"), "ppe");
  assert.equal(accountCategory("10405030"), "sx");
  assert.equal(accountCategory("10404010"), "cons");
  assert.ok(isDistributionAccount("10402020"));
  assert.ok(!isDistributionAccount("10404010"));
});

test("the Super Administrator email matches firestore.rules", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  for (const e of SUPERADMIN_EMAILS) assert.ok(rules.includes(`'${e}'`), `${e} missing from firestore.rules`);
});

test("monthly RSMI by JEV date: an RIS goes into the month Accounting posted it", async () => {
  const { rsmi: R, rsmiMonths, risAwaitingPosting } = await import("../public/js/core/logic.js");
  const l = (q, c) => ({ stockNo: "OS-1", description: "Bond paper", unit: "ream", qty: q, unitCost: c, accountCode: "10404010" });
  const docs = [
    { fund: "GF", docType: "ris", status: "issued", number: "2026-09-0007", date: "2026-09-28", recipient: { office: "MHO" }, lines: [l(2, 250)], posting: { posted: true, date: "2026-10-02", ref: "JEV-10-01" } },
    { fund: "GF", docType: "ris", status: "issued", number: "2026-10-0001", date: "2026-10-05", recipient: { office: "MTO" }, lines: [l(4, 250)], posting: { posted: true, date: "2026-10-20", ref: "JEV-10-05" } },
    { fund: "GF", docType: "ris", status: "issued", number: "2026-10-0002", date: "2026-10-30", lines: [l(1, 250)], posting: { posted: false } },
    { fund: "GF", docType: "ris", status: "cancelled", number: "2026-10-0003", date: "2026-10-30", lines: [l(9, 1)], posting: { posted: true, date: "2026-10-30", ref: "X" } },
    { fund: "SEF", docType: "ris", status: "issued", number: "2026-10-0001", date: "2026-10-05", lines: [l(1, 1)], posting: { posted: true, date: "2026-10-05", ref: "S" } }
  ];
  const oct = R(docs, "GF", "2026-10-01", "2026-10-31", { byJev: true });
  assert.deepEqual(oct.lines.map(x => x.risNo), ["2026-09-0007", "2026-10-0001"], "the September RIS posted in October is in October's RSMI");
  assert.equal(oct.total, 1500);
  assert.deepEqual(oct.jevs, ["JEV-10-01", "JEV-10-05"]);
  assert.equal(R(docs, "GF", "2026-09-01", "2026-09-30", { byJev: true }).lines.length, 0);
  assert.deepEqual(rsmiMonths(docs, "GF").map(m => [m.period, m.ris, m.total]), [["2026-10", 2, 1500]]);
  assert.deepEqual(risAwaitingPosting(docs, "GF").map(d => d.number), ["2026-10-0002"]);
});

test("chart of accounts: the administrator adds accounts or changes standard ones, and can change them back", () => {
  const n = PPE_ACCOUNTS.length;
  applyChartOfAccounts([
    { kind: "sx", code: "10405150", name: "Semi-Expendable Hospital Furniture", group: "Semi-Expendable Machinery and Equipment" },
    { kind: "ppe", code: "10705110", name: "Medical Equipment", group: "Machinery & Equipment", depreciable: true, life: 7, expCode: "50501050" }
  ]);
  assert.equal(accountName("10405150"), "Semi-Expendable Hospital Furniture");
  assert.equal(isSxAccount("10405150"), true); assert.equal(accountCategory("10405150"), "sx");
  assert.equal(accountByCodeOrName("", "Hospital Furniture", "sx"), "10405150");
  assert.equal(ppeAccount("10705110").life, 7); assert.equal(PPE_ACCOUNTS.length, n);
  assert.deepEqual(checkChartAccount({ kind: "sx", code: "10705110", name: "x", group: "y" }), ["Code 10705110 is already a PPE account."]);
  assert.match(checkChartAccount({ kind: "ppe", code: "1070", name: "x", group: "y" })[0], /8 digits/);
  assert.match(checkChartAccount({ kind: "ppe", code: "10799020", name: "Other", group: "Other PPE", depreciable: true, life: 0 })[0], /useful life/);
  applyChartOfAccounts([]);
  assert.equal(accountName("10405150"), ""); assert.equal(ppeAccount("10705110").life, 5);
});

test("RSMI recapitulation as the proposed accounting entry: expense debited, inventory credited, per account", async () => {
  const { rsmiEntry } = await import("../public/js/core/logic.js");
  const e = rsmiEntry([{ accountCode: "10404010", amount: 2500 }, { accountCode: "10404010", amount: 500 }, { accountCode: "10404070", amount: 1200 }, { accountCode: "10404130", amount: 100 }]);
  assert.deepEqual(e.debits.map(d => [d.code, d.amount]), [["50203010", 3000], ["50203080", 1200], ["", 100]]);
  assert.equal(e.debits[0].name, "Office Supplies Expenses"); assert.equal(e.debits[2].name, "Expense account to be set");
  assert.deepEqual(e.credits.map(c => [c.code, c.amount]), [["10404010", 3000], ["10404070", 1200], ["10404130", 100]]);
  assert.equal(e.total, 4300);
});

test("property numbers: year purchased - group - sub major - GL - series, one series per year across all accounts", async () => {
  const { propertyNoPrefix, nextPropertySeq, suggestPropertyNos } = await import("../public/js/core/logic.js");
  assert.equal(propertyNoPrefix("10705020", 2026), "2026-07-05-02");
  assert.equal(propertyNoPrefix("10405030", "2026"), "2026-04-05-03");
  assert.equal(propertyNoPrefix("", 2026), "");
  assert.equal(nextPropertySeq(["2026-07-05-02-0004", "2026-04-05-03-0009", "2025-07-05-02-0099", "PPE-1"], 2026), 10);
  assert.equal(nextPropertySeq([], 2027), 1);
  assert.deepEqual(suggestPropertyNos([{ accountCode: "10705020" }, { accountCode: "10707010" }], 2026, ["2026-07-05-02-0001"]), ["2026-07-05-02-0002", "2026-07-07-01-0003"]);
});

test("the RSMI lists only the RIS not yet posted by Accounting, by RIS date", async () => {
  const { rsmi: R, rsmiMonths } = await import("../public/js/core/logic.js");
  const l = q => ({ stockNo: "OS-1", description: "Bond paper", unit: "ream", qty: q, unitCost: 250, accountCode: "10404010" });
  const docs = [
    { fund: "GF", docType: "ris", status: "issued", number: "R1", date: "2026-10-05", lines: [l(2)], posting: { posted: true, date: "2026-10-06", ref: "JEV-1" } },
    { fund: "GF", docType: "ris", status: "issued", number: "R2", date: "2026-10-30", lines: [l(1)], posting: { posted: false } },
    { fund: "GF", docType: "ris", status: "issued", number: "R3", date: "2026-11-02", lines: [l(3)] },
    { fund: "GF", docType: "ris", status: "cancelled", number: "R4", date: "2026-10-10", lines: [l(9)] }
  ];
  assert.deepEqual(R(docs, "GF", "2026-10-01", "2026-10-31", { unposted: true }).lines.map(x => x.risNo), ["R2"]);
  assert.deepEqual(R(docs, "GF", "2026-10-01", "2026-11-30", { unposted: true }).lines.map(x => x.risNo), ["R2", "R3"]);
  assert.deepEqual(rsmiMonths(docs, "GF", { unposted: true }).map(m => [m.period, m.ris]), [["2026-11", 1], ["2026-10", 1]]);
});
