// PMS register features: dated revaluations / reclassifications / impairments, the printed-card timeline,
// the Trial Balance gate on depreciation and the global search (no Firebase needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountAsOf, fundAsOf, costAsOf, impairmentAsOf, adjustedCostAsOf, carryingAmount, amountFor, depreciationFor, reconcile, costGate, checkManualAsset, hasPostedDepreciation } from "../public/js/core/assets.js";
import { assetTimeline, propertyCardRows, specialGroup, searchAll } from "../public/js/core/cards.js";

const truck = { id: "T", fund: "GF", itemType: "ppe", accountCode: "10706010", cost: 1200000, residualValue: 60000, usefulLifeYears: 10, depreciable: true,
  dateAcquired: "2025-06-10", status: "active", description: "Dump truck", propertyNo: "PPE-01", qty: 1, source: { kind: "par", number: "2025-06-0001" } };

test("special card groups by account (PMS)", () => {
  assert.equal(specialGroup("10701010"), "land");
  assert.equal(specialGroup("10703010"), "road");
  assert.equal(specialGroup("10703020"), "otherinfra");
  assert.equal(specialGroup("10704010"), "buildings");
  assert.equal(specialGroup("10703990"), "otherinfra");
  assert.equal(specialGroup("10704990"), "buildings", "Other Structures print on the Buildings card");
  assert.equal(specialGroup("10702990"), "land");
  assert.equal(specialGroup("10801020"), "biological");
  assert.equal(specialGroup("10705030"), "");
});

test("revaluation, reclassification and fund transfer take effect from their month", () => {
  const a = { ...truck, cost: 1500000, accountCode: "10706990", fund: "SEF",
    revaluations: [{ date: "2026-03-15", oldCost: 1200000, newCost: 1500000, oldResidual: 60000, newResidual: 60000 }],
    accountChanges: [{ date: "2026-02-01", oldCode: "10706010", newCode: "10706990" }],
    fundChanges: [{ date: "2026-04-01", oldFund: "GF", newFund: "SEF" }] };
  assert.equal(costAsOf(a, "2026-02"), 1200000);
  assert.equal(costAsOf(a, "2026-03"), 1500000);
  assert.equal(accountAsOf(a, "2026-01"), "10706010");
  assert.equal(accountAsOf(a, "2026-02"), "10706990");
  assert.equal(fundAsOf(a, "2026-03"), "GF");
  assert.equal(fundAsOf(a, "2026-04"), "SEF");
  // depreciation for March is in the General Fund on the new account; April moves to SEF
  assert.equal(depreciationFor([a], "GF", "2026-03", []).rows[0].accountCode, "10706990");
  assert.equal(depreciationFor([a], "GF", "2026-04", []).rows.length, 0);
  assert.equal(depreciationFor([a], "SEF", "2026-04", []).rows.length, 1);
  // the reconciliation follows the same dates
  const rec = reconcile([a], [], {}, null, "GF", "2026-02", []);
  assert.deepEqual(rec.map(r => [r.code, r.regCost]), [["10706990", 1200000]]);
});

test("impairment lowers the carrying amount and what is left to depreciate; SX adjusted cost", () => {
  const a = { ...truck, adjustments: [{ type: "impairment", date: "2026-01-10", amount: 100000 }] };
  assert.equal(impairmentAsOf(a, "2025-12"), 0);
  assert.equal(impairmentAsOf(a, "2026-01"), 100000);
  assert.equal(carryingAmount(a, "2026-01", [{ period: "2026-01", amounts: { T: 9500 } }]), 1090500);
  const nearly = { ...a, depBaseline: { period: "2026-01", amount: 1035000 } };
  assert.equal(amountFor(nearly, "2026-02", []), 5000, "1,200,000 − 60,000 residual − 1,035,000 AD − 100,000 impairment");
  const sx = { id: "S", itemType: "sx", cost: 20000, priorAdjustment: 2000, adjustments: [{ type: "adjustment", date: "2026-01-05", amount: -1000 }, { type: "impairment", date: "2026-02-01", amount: 3000 }] };
  assert.equal(adjustedCostAsOf(sx, "2026-01"), 17000);
  assert.equal(adjustedCostAsOf(sx, "2026-02"), 14000);
});

test("the card timeline: acquisition, depreciation, revaluation, transfer, verified repair, disposal and reactivation", () => {
  const a = { ...truck, cost: 1300000, revaluations: [{ date: "2026-02-20", oldCost: 1200000, newCost: 1300000, reason: "Appraisal" }],
    status: "active", reactivations: [{ date: "2026-05-02", reason: "Disposed by mistake" }] };
  const runs = [{ period: "2025-07", amounts: { T: 9500 }, jevNo: "J-7" }, { period: "2025-08", amounts: { T: 9500, X: 1 } }];
  const movements = [{ id: "m1", docType: "ptr", number: "2026-03-0001", date: "2026-03-01", to: { name: "Juan", office: "MEO" }, lines: [{ assetId: "T", qty: 1 }], status: "done" },
    { id: "m2", docType: "dsp", number: "2026-04-0001", date: "2026-04-01", mode: "Lost / stolen", lines: [{ assetId: "T", qty: 1 }], status: "done" },
    { id: "m3", docType: "ptr", number: "x", date: "2026-03-05", lines: [{ assetId: "T" }], status: "cancelled" }];
  const repairs = [{ assetId: "T", status: "verified", jobOrderDate: "2025-09-01", jobOrderNo: "JO-1", nature: "Engine", totalCost: 15000, parts: [] },
    { assetId: "T", status: "submitted", jobOrderDate: "2025-10-01", jobOrderNo: "JO-2", totalCost: 1, parts: [] }];
  const rows = assetTimeline(a, { runs, movements, repairs });
  assert.deepEqual(rows.map(r => r.kind), ["acquire", "depreciation", "depreciation", "repair", "revalue", "transfer", "retire", "reactivate"]);
  assert.equal(rows[0].cost, 1200000, "the first row is the original cost, before the revaluation");
  assert.equal(rows[0].reference, "PAR 2025-06-0001");
  assert.equal(rows[2].accum, 19000);
  assert.equal(rows[2].adjusted, 1181000);
  assert.equal(rows[1].reference, "JEV J-7");
  assert.equal(rows[4].cost, 1300000);
  assert.equal(rows[5].label, "Transfer to Juan");
  assert.equal(rows[6].balanceQty, 0);
  assert.equal(rows[7].balanceQty, 1);
  assert.deepEqual(propertyCardRows(rows).map(r => r.kind), ["acquire", "revalue", "transfer", "retire", "reactivate"]);
});

test("imported items start from the balance forward", () => {
  const a = { ...truck, source: { kind: "import" }, depBaseline: { period: "2025-12", amount: 57000 } };
  const rows = assetTimeline(a, { runs: [{ period: "2026-01", amounts: { T: 9500 } }] });
  assert.deepEqual(rows.map(r => [r.kind, r.accum]), [["acquire", 0], ["baseline", 57000], ["depreciation", 66500]]);
  assert.equal(rows[0].reference, "Brought forward from PMS");
});

test("depreciation is held until the month before ties out on PPE cost", () => {
  const assets = [truck, { id: "S", fund: "GF", itemType: "sx", accountCode: "10405020", cost: 9000, status: "active", dateAcquired: "2025-01-01" }];
  assert.equal(costGate(assets, [], [], "GF", "2026-01").reason, "no-tb");
  const tb = accounts => [{ fund: "GF", period: "2025-12", accounts }];
  assert.equal(costGate(assets, [], tb({ 10706010: { debit: 1200000, credit: 0 } }), "GF", "2026-01").ok, true, "semi-expendable variances don't hold depreciation");
  const g = costGate(assets, [], tb({ 10706010: { debit: 1100000, credit: 0 } }), "GF", "2026-01");
  assert.equal(g.ok, false);
  assert.deepEqual(g.flagged.map(r => r.code), ["10706010"]);
  assert.equal(costGate(assets, [], [{ fund: "GF", period: "2025-11", accounts: {} }], "GF", "2026-01").reason, "no-tb", "it must be the month right before");
});

test("manual items: required fields, opening accumulated depreciation, lock once depreciated", () => {
  const f = { fund: "GF", itemType: "ppe", accountCode: "10705030", description: "Laptop", qty: 1, cost: 60000, dateAcquired: "2024-01-01" };
  assert.equal(checkManualAsset(f), "");
  assert.match(checkManualAsset({ ...f, accountCode: "10405020" }), /PPE account/);
  assert.match(checkManualAsset({ ...f, depBaseline: { amount: 5000, period: "" } }), /as of/);
  assert.match(checkManualAsset({ ...f, depBaseline: { amount: 70000, period: "2025-12" } }), /more than the cost/);
  assert.equal(checkManualAsset({ ...f, itemType: "sx", accountCode: "" }), "", "a found item may wait for its account");
  assert.equal(hasPostedDepreciation({ id: "T" }, [{ amounts: { X: 1 } }]), false);
  assert.equal(hasPostedDepreciation({ id: "T" }, [{ amounts: { T: 1 } }]), true);
});

test("global search spans property, documents, movements, repairs, AIRs and CIP in the fund", () => {
  const d = { assets: [truck, { ...truck, id: "U", fund: "SEF" }], airs: [{ fund: "GF", status: "approved", airNo: "2026-01-0003", supplier: "Truck Depot", lines: [] }],
    docs: [], movements: [], repairs: [{ fund: "GF", jobOrderNo: "JO-9", description: "Dump truck" }], cip: [] };
  const r = searchAll("truck", d, "GF");
  assert.equal(r.assets.length, 1);
  assert.equal(r.airs.length, 1);
  assert.equal(r.repairs.length, 1);
  assert.equal(searchAll("t", d, "GF"), null);
});
