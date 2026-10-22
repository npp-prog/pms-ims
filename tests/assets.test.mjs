// Property register rules: depreciation, movements, reconciliation, import (no Firebase needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths, periodEnd, residualFor, isDepreciable, accumAsOf, amountFor, depreciationFor, checkPostPeriod, ownedAt,
  checkMovement, movementDocType, parseTrialBalance, reconcile, normalizeAssets, normalizeStock
} from "../public/js/core/assets.js";

// A real record from the PMS December 2025 baseline (seed_assets.json, id a1).
const fence = { id: "a1", fund: "GF", itemType: "ppe", accountCode: "10702990", cost: 999630.45, residualValue: 49981.52, usefulLifeYears: 10, depreciable: true,
  dateAcquired: "2024-12-27", status: "active", depBaseline: { period: "2025-12", amount: 94964.89 } };
const laptop = { id: "L", fund: "GF", itemType: "ppe", accountCode: "10705030", cost: 60000, residualValue: residualFor("10705030", 60000), usefulLifeYears: 5, depreciable: true, dateAcquired: "2026-01-15", status: "active" };

test("periods", () => {
  assert.equal(addMonths("2025-12", 1), "2026-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-03", -15), "2024-12");
  assert.equal(periodEnd("2024-02"), "2024-02-29");
  assert.equal(periodEnd("2026-04"), "2026-04-30");
});

test("residual value: 5% of cost, zero for infrastructure", () => {
  assert.equal(residualFor("10705030", 60000), 3000);
  assert.equal(residualFor("10703010", 1000000), 0);
});

test("depreciation follows PMS: month after acquisition / baseline, straight-line, capped at residual", () => {
  assert.equal(amountFor(fence, "2025-12", []), 0, "nothing on or before the imported baseline");
  assert.equal(amountFor(fence, "2026-01", []), 7913.74); // (999630.45 - 49981.52) / 120
  assert.equal(amountFor(laptop, "2026-01", []), 0, "not in the month acquired");
  assert.equal(amountFor(laptop, "2026-02", []), 950); // (60000 - 3000) / 60
  // accumulated = baseline + posted runs
  const runs = [{ period: "2026-01", amounts: { a1: 7913.74 } }, { period: "2026-02", amounts: { a1: 7913.74, L: 950 } }];
  assert.equal(accumAsOf(fence, "2025-12", runs), 94964.89);
  assert.equal(accumAsOf(fence, "2026-02", runs), 110792.37);
  assert.equal(accumAsOf(laptop, "2026-01", runs), 0);
  // the last month only takes what is left above the residual value
  const nearlyDone = { ...laptop, depBaseline: { period: "2026-02", amount: 56500 } };
  assert.equal(amountFor(nearlyDone, "2026-03", []), 500);
  assert.equal(amountFor({ ...nearlyDone, depBaseline: { period: "2026-02", amount: 57000 } }, "2026-03", []), 0);
});

test("what is not depreciated", () => {
  assert.ok(!isDepreciable({ ...laptop, itemType: "sx" }));
  assert.ok(!isDepreciable({ ...laptop, accountCode: "10701010" }), "land");
  assert.ok(!isDepreciable({ ...laptop, accountCode: "10710020" }), "construction in progress");
  assert.ok(!isDepreciable({ ...laptop, usefulLifeYears: 0 }));
  assert.ok(!isDepreciable({ ...laptop, status: "cancelled" }));
  const sold = { ...laptop, status: "disposed", disposal: { date: "2026-04-10" } };
  assert.equal(amountFor(sold, "2026-03", []), 950);
  assert.equal(amountFor(sold, "2026-04", []), 0, "not in the month of disposal");
  assert.ok(ownedAt(sold, "2026-03") && !ownedAt(sold, "2026-04"));
  assert.ok(!ownedAt({ ...laptop, status: "disposed", disposal: { date: "" } }, "2026-12"), "retired in PMS without a date");
  assert.ok(!ownedAt(laptop, "2025-12"), "not yet acquired");
});

test("JEV summary groups by account and pairs expense with accumulated depreciation", () => {
  const p = depreciationFor([fence, laptop, { ...laptop, id: "L2", fund: "SEF" }], "GF", "2026-02", [{ period: "2026-01", amounts: { a1: 7913.74 } }]);
  assert.equal(p.total, 8863.74);
  assert.deepEqual(p.byAccount.map(r => [r.code, r.expCode, r.adCode, r.amount]), [["10702990", "50501020", "10702991", 7913.74], ["10705030", "50501050", "10705031", 950]]);
});

test("periods are posted in order and never in the future", () => {
  const runs = [{ fund: "GF", period: "2026-01" }, { fund: "SEF", period: "2026-05" }];
  assert.equal(checkPostPeriod(runs, "GF", "2026-02", "2026-10-21"), "");
  assert.match(checkPostPeriod(runs, "GF", "2026-03", "2026-10-21"), /2026-02 first/);
  assert.match(checkPostPeriod(runs, "GF", "2026-01", "2026-10-21"), /already posted/);
  assert.match(checkPostPeriod(runs, "GF", "2026-11", "2026-10-21"), /future/);
  assert.equal(checkPostPeriod(runs, "TF", "2025-07", "2026-10-21"), "", "first period of a fund can be any past month");
});

test("movements: one kind, one fund, one holder, still on hand", () => {
  const a = { itemType: "ppe", fund: "GF", status: "active", holder: { name: "Maria" } };
  assert.equal(checkMovement([a, { ...a }], "transfer"), "");
  assert.match(checkMovement([a, { ...a, itemType: "sx" }], "transfer"), /not both/);
  assert.match(checkMovement([a, { ...a, holder: { name: "Jose" } }], "transfer"), /same accountable officer/);
  assert.match(checkMovement([a, { ...a, fund: "SEF" }], "transfer"), /one fund/);
  assert.match(checkMovement([{ ...a, status: "disposed" }], "dispose"), /can't be moved/);
  assert.match(checkMovement([{ ...a, status: "returned" }], "return"), /already returned/);
  assert.equal(checkMovement([{ ...a, status: "returned" }], "transfer"), "", "returned items can be re-issued by transfer");
  assert.deepEqual(["transfer", "return", "dispose"].flatMap(k => ["ppe", "sx"].map(t => movementDocType(k, t))), ["ptr", "itr", "prs", "rrsp", "dsp", "dsp"]);
});

test("Trial Balance parsing: tab or comma, with or without the name, amounts with commas", () => {
  const tb = parseTrialBalance("Account Code\tAccount\tDebit\tCredit\n10705020\tOffice Equipment\t2,063,166.50\t0\n10705021,\"Accumulated Depreciation - Office Equipment, net\",0,\"756,648.50\"\n10404010\t15000\t0\nTOTAL\t\t1\t1");
  assert.deepEqual(Object.keys(tb).sort(), ["10404010", "10705020", "10705021"]);
  assert.equal(tb["10705020"].debit, 2063166.5);
  assert.equal(tb["10705021"].credit, 756648.5);
  assert.equal(tb["10404010"].debit, 15000);
});

test("reconciliation compares cost and accumulated depreciation per account as of the month end", () => {
  const runs = [{ period: "2026-01", amounts: { a1: 7913.74 } }];
  const tb = { "10702990": { debit: 999630.45, credit: 0 }, "10702991": { debit: 0, credit: 102878.63 }, "10404010": { debit: 2500, credit: 0 }, "10101010": { debit: 5, credit: 0 } };
  const rows = reconcile([fence, laptop], runs, { "10404010": 2400 }, tb, "GF", "2026-01");
  const f = rows.find(r => r.code === "10702990");
  assert.deepEqual([f.regCost, f.tbCost, f.regAD, f.tbAD, f.ok], [999630.45, 999630.45, 102878.63, 102878.63, true]);
  const inv = rows.find(r => r.code === "10404010");
  assert.deepEqual([inv.regCost, inv.varCost, inv.ok], [2400, -100, false]);
  assert.ok(!rows.some(r => r.code === "10101010"), "cash is not a register account");
  const lap = rows.find(r => r.code === "10705030");
  assert.equal(lap.regCost, 60000, "the laptop is on hand at the end of January");
  assert.equal(lap.ok, false, "and missing from this TB");
  assert.ok(!reconcile([laptop], [], {}, {}, "GF", "2025-12").length, "not yet acquired in December");
});

test("import of the PMS register: seed JSON and CSV export formats", () => {
  const seed = [
    { id: "a1", account_code: 10702990, account_name: "Other Land Improvements", property_id: "255.0", date_acquired: "2024-12-27", description: "PERIMETER FENCE", location: "Brgy. East",
      accountable_officer: "", cost: 999630.45, residual_value: 49981.52, useful_life_years: 10.0, accum_depr_baseline: 94964.89, depreciable: true, status: "active" },
    { id: "a2", account_code: 10701010, account_name: "Land", property_id: "1", date_acquired: "1990-01-01", description: "LOT", cost: 500000, residual_value: 0, useful_life_years: 0, accum_depr_baseline: 0, depreciable: false, status: "active" },
    { id: "a3", account_code: 10706010, account_name: "Motor Vehicles", property_id: "77", description: "OLD TRUCK", cost: 900000, useful_life_years: 7, accum_depr_baseline: 855000, status: "retired" },
    { id: "a4", account_code: 99999999, description: "MYSTERY", cost: 1 }
  ];
  const { items, errors } = normalizeAssets(seed, { fund: "GF", baselinePeriod: "2025-12" });
  assert.equal(items.length, 3);
  assert.deepEqual(errors.map(e => e.line), [5]);
  assert.deepEqual([items[0].propertyNo, items[0].accountCode, items[0].depBaseline, items[0].depreciable], ["255", "10702990", { period: "2025-12", amount: 94964.89 }, true]);
  assert.equal(items[1].depreciable, false);
  assert.equal(items[2].status, "disposed");
  const csv = [{ Fund: "Special Education Fund", Type: "Semi-Expendable", "Property ID": "", SEN: "SPHV-2026-05-0027", Category: "Semi-Expendable Office Equipment", Description: "Locker",
    "Accountable Officer": "Ana", "Date Acquired": "05/02/2026", Cost: "7,500.00", "Residual Value": "0", "Useful Life (yrs)": "", "Accum. Depr.": "n/a", Status: "active" }];
  const r = normalizeAssets(csv, { fund: "GF", baselinePeriod: "2025-12" }).items[0];
  assert.deepEqual([r.fund, r.itemType, r.accountCode, r.propertyNo, r.dateAcquired, r.cost, r.depBaseline, r.holder.name], ["SEF", "sx", "10405020", "SPHV-2026-05-0027", "2026-05-02", 7500, null, "Ana"]);
});

test("import of IMS supplies on hand", () => {
  const rows = [
    { Fund: "General Fund", "Account Code": "10404010", "Account Name": "Office Supplies Inventory", "Stock No.": "os-0001", Description: "Bond paper", Unit: "ream", "Balance Qty": "40", "Unit Cost": "250.00", "Balance Value": "10000.00" },
    { Fund: "General Fund", "Account Code": "10404010", "Stock No.": "OS-0002", Description: "Pens", Unit: "box", "Balance Qty": "3", "Unit Cost": "", "Balance Value": "450" },
    { Fund: "General Fund", "Account Code": "10404010", "Stock No.": "OS-0003", Description: "Used up", Unit: "pc", "Balance Qty": "0", "Unit Cost": "5" },
    { Fund: "General Fund", "Account Code": "10705030", "Stock No.": "X-1", Description: "Laptop", "Balance Qty": "1", "Unit Cost": "50000" }
  ];
  const { items, errors } = normalizeStock(rows, { fund: "GF" });
  assert.deepEqual(items.map(i => [i.stockNo, i.qty, i.unitCost]), [["OS-0001", 40, 250], ["OS-0002", 3, 150]]);
  assert.match(errors[0].problem, /not an inventory account/);
});

import { billingTotal, cipTotal, cipStatus, cipTransferAccount, cipOpenAt, normalizeCip, repairTotal } from "../public/js/core/assets.js";

test("CIP: billing totals, status, default transfer account (PMS rules)", () => {
  const p = { billings: [{ date: "2026-03-15", ref: "1ST BILLING", byContract: 1200000 }, { date: "2026-05-02", ref: "2ND BILLING", materials: 1000.5, labor: 500, adjustments: -0.5 }] };
  assert.equal(billingTotal(p.billings[1]), 1500);
  assert.equal(cipTotal(p), 1201500);
  assert.equal(cipTotal(p, "2026-03-31"), 1200000, "as of a date");
  assert.equal(cipStatus(p), "in_progress");
  assert.equal(cipStatus({ billings: [{ ref: "2ND & FINAL BILLING" }] }), "finished", "a final billing marks it complete");
  assert.equal(cipStatus({ billings: [{ ref: "FINAL" }], statusOverride: "in_progress" }), "in_progress");
  assert.equal(cipStatus({ status: "completed", billings: [] }), "completed");
  assert.deepEqual(["10710010", "10710020", "10710030"].map(cipTransferAccount), ["10702990", "10703990", "10704990"]);
  const done = { status: "completed", completed: { date: "2026-06-10" } };
  assert.ok(cipOpenAt(done, "2026-05") && !cipOpenAt(done, "2026-06"));
});

test("CIP is in the Trial Balance comparison until it is transferred", () => {
  const cip = [{ fund: "GF", accountCode: "10710030", billings: [{ date: "2025-11-30", byContract: 7000000 }, { date: "2026-01-10", byContract: 1000000 }] },
    { fund: "GF", accountCode: "10710030", status: "completed", completed: { date: "2025-10-01" }, billings: [{ date: "2025-05-01", byContract: 99 }] }];
  const [r] = reconcile([], [], {}, { "10710030": { debit: 7000000, credit: 0 } }, "GF", "2025-12", cip);
  assert.deepEqual([r.code, r.regCost, r.ok, r.regAD], ["10710030", 7000000, true, null]);
});

test("CIP import: PMS bulk-billing rows and the CIP Projects export", () => {
  const bulk = [
    { account_code: "10710020", cip_code: "2025-020-01", project_name: "Footbridge", contractor: "ABC", date: "3/15/2026", ref: "1ST BILLING", by_contract: "1,200,000.00" },
    { account_code: "10710020", cip_code: "2025-020-01", date: "2026-05-02", ref: "2ND & FINAL BILLING", by_contract: "800000", admin_others: "250" },
    { account_code: "10705020", cip_code: "X", project_name: "Not CIP", by_contract: "5" }];
  const a = normalizeCip(bulk, { fund: "GF", asOf: "2025-12-31" });
  assert.equal(a.projects.length, 1);
  assert.equal(a.projects[0].billings.length, 2);
  assert.equal(cipTotal(a.projects[0]), 2000250);
  assert.equal(a.projects[0].billings[0].date, "2026-03-15");
  assert.match(a.errors[0].problem, /not a Construction in Progress account/);
  const b = normalizeCip([
    { Fund: "General Fund", "CIP No.": "2020-020-06", "Account Code": "10710030", "Name of Project": "MPB", "Project Cost": "5,000,000", "Total Billed to Date": "3500000.00", Status: "In progress" },
    { Fund: "General Fund", "CIP No.": "2019-1", "Account Code": "10710030", "Name of Project": "Old", "Total Billed to Date": "1", Status: "Transferred" }], { fund: "GF", asOf: "2025-12-31" });
  assert.deepEqual([b.projects.length, b.skipped, cipTotal(b.projects[0]), b.projects[0].billings[0].ref, b.projects[0].projectCost], [1, 1, 3500000, "Balance brought forward", 5000000]);
});

test("repair totals", () => {
  assert.equal(repairTotal({ parts: [{ cost: 1500.25 }, { cost: "350" }, {}] }), 1850.25);
});

test("PMS assets on a CIP account are imported as CIP projects, not PPE", () => {
  const r = normalizeAssets([
    { account_code: 10710030, property_id: "", description: "MULTI-PURPOSE BUILDING (ONGOING)", cost: 6826756.78, status: "active" },
    { account_code: 10705020, property_id: "9", description: "PRINTER", cost: 9000, useful_life_years: 5, status: "active" }
  ], { fund: "GF", baselinePeriod: "2025-12" });
  assert.equal(r.items.length, 1);
  assert.equal(r.cip.length, 1);
  assert.deepEqual([r.cip[0].accountCode, cipTotal(r.cip[0]), r.cip[0].billings[0].date, r.cip[0].billings[0].ref], ["10710030", 6826756.78, "2025-12-31", "Balance brought forward"]);
});
