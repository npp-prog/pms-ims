// Document numbering set by the administrator, and bringing PMS users over (no Firebase needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { numberingFor, numberingDefault, seriesKey, formatDocNo, checkNumbering, cleanDocNo, counterKey } from "../public/js/core/logic.js";
import { parsePmsUsers, suggestRole } from "../public/js/core/users.js";

test("default numbering is the PMS / IMS format and keeps the existing counters", () => {
  const c = numberingFor({}, "par");
  assert.deepEqual(c, { mode: "auto", format: "{YYYY}-{MM}-{####}", reset: "monthly", start: 1 });
  assert.equal(seriesKey(c, "GF", "par", "2026-10-21").key, counterKey("GF", "par", "2026-10-21").key);
  assert.equal(formatDocNo(c.format, { date: "2026-10-21", seq: 7 }), "2026-10-0007");
  const ics = numberingFor(null, "ics");
  assert.equal(formatDocNo(ics.format, { date: "2026-05-02", cls: "low", seq: 27 }), "SPLV-2026-05-0027");
  assert.equal(seriesKey(ics, "SEF", "ics", "2026-05-02", "high").key, "SEF_SPHV_2026-05");
});

test("custom formats, yearly and running series, starting number", () => {
  const s = { numbering: { air: { format: "AIR-{FUND}-{YY}-{#####}", reset: "yearly", start: 151 }, ptr: { format: "PTR-{######}", reset: "never" } } };
  const air = numberingFor(s, "air");
  assert.equal(air.start, 151);
  assert.equal(seriesKey(air, "GF", "air", "2026-10-21").key, "GF_AIR_2026");
  assert.equal(formatDocNo(air.format, { date: "2026-10-21", fund: "GF", seq: air.start }), "AIR-GF-26-00151");
  const ptr = numberingFor(s, "ptr");
  assert.equal(seriesKey(ptr, "TF", "ptr", "2027-01-05").key, "TF_PTR_ALL");
  assert.equal(formatDocNo(ptr.format, { date: "2027-01-05", seq: 12 }), "PTR-000012");
  assert.equal(formatDocNo("{####}", { date: "2026-01-01", seq: 123456 }), "123456", "the sequence never gets cut");
  assert.equal(numberingDefault("ics").format, "{CLASS}-{YYYY}-{MM}-{####}");
});

test("a numbering setting that would repeat numbers is refused", () => {
  const ok = { mode: "auto", format: "{YYYY}-{MM}-{####}", reset: "monthly", start: 1 };
  assert.equal(checkNumbering("par", ok), "");
  assert.match(checkNumbering("par", { ...ok, format: "{YYYY}-{MM}" }), /sequence/);
  assert.match(checkNumbering("par", { ...ok, format: "{YYYY}-{####}" }), /month/);
  assert.match(checkNumbering("par", { ...ok, reset: "yearly", format: "{MM}-{####}" }), /year/);
  assert.equal(checkNumbering("par", { ...ok, reset: "never", format: "PAR-{#####}" }), "");
  assert.match(checkNumbering("ics", { ...ok }), /CLASS/);
  assert.match(checkNumbering("par", { ...ok, format: "{YYYY}-{MM}-{DD}-{####}" }), /Unknown/);
  assert.match(checkNumbering("par", { ...ok, start: 0 }), /starting number/);
  assert.equal(checkNumbering("par", { mode: "manual", format: "" }), "", "manual numbering has no format");
  assert.equal(cleanDocNo("  PAR  2026 - 01 "), "PAR 2026 - 01");
});

test("PMS users: backup user_roles, Auth export and pasted lines, merged by email", () => {
  const backup = JSON.stringify({ assets: [], user_roles: [
    { id: "liza@x.ph", email: "liza@x.ph", approved: true, display_name: "Liza Reyes", tabs: { register: "edit", depreciation: "edit" } },
    { id: "ramon@x.ph", email: "ramon@x.ph", approved: true, tabs: { parics: "edit", register: "view" } },
    { id: "boss@x.ph", email: "boss@x.ph", approved: true, is_admin: true },
    { id: "viewer@x.ph", email: "viewer@x.ph", approved: true, tabs: { register: "view" } },
    { id: "new@gmail.com", email: "new@gmail.com", approved: false, pending: true },
    { id: "npp@mgocandoniaccounting.org", email: "npp@mgocandoniaccounting.org", is_admin: true }
  ] });
  const auth = JSON.stringify({ users: [{ localId: "1", email: "Ramon@x.ph", displayName: "Ramon Cruz" }, { localId: "2", email: "pw.only@x.ph", displayName: "Pat Only" }] });
  const { users, errors } = parsePmsUsers([backup, auth, "ana@x.ph, Ana Lim, enduser, Municipal Health Office, Midwife\nnot-an-email"]);
  assert.deepEqual(errors, []);
  const by = Object.fromEntries(users.map(u => [u.email, u]));
  assert.equal(by["liza@x.ph"].role, "accounting");
  assert.equal(by["ramon@x.ph"].role, "gso");
  assert.equal(by["ramon@x.ph"].name, "Ramon Cruz", "the Auth export fills the missing name");
  assert.equal(by["boss@x.ph"].role, "admin");
  assert.equal(by["viewer@x.ph"].role, "enduser");
  assert.equal(by["new@gmail.com"].include, false, "never approved in PMS: unticked");
  assert.equal(by["pw.only@x.ph"].include, true);
  assert.deepEqual([by["ana@x.ph"].role, by["ana@x.ph"].office, by["ana@x.ph"].position], ["enduser", "Municipal Health Office", "Midwife"]);
  assert.equal(by["npp@mgocandoniaccounting.org"], undefined, "the Super Administrator claims access by signing in");
  assert.equal(users.length, 7);
  assert.equal(suggestRole({ tabs: { hor: "edit" } }), "gso");
  assert.match(parsePmsUsers(["{bad json"]).errors[0], /JSON/);
});

test("item list: a known description gives its Item No.; typing the Item No. gives the description", async () => {
  const { buildItemCatalog, findItem, itemKey } = await import("../public/js/core/logic.js");
  const airs = [
    { status: "approved", date: "2026-01-10", lines: [{ description: "Bond paper, A4, 70gsm", unit: "ream", stockNo: "OS-0001", category: "cons" }] },
    { status: "issued", date: "2026-03-01", lines: [{ description: "bond paper a4 70gsm", unit: "ream", stockNo: "OS-0009", category: "cons" }] },
    { status: "draft", date: "2026-04-01", lines: [{ description: "Ballpen", stockNo: "XX" }] }
  ];
  const items = [{ description: "Laptop computer, 14-inch", unit: "unit", stockNo: "ICT-014", category: "ppe", at: "2026-02-01" }];
  const cat = buildItemCatalog(items, airs);
  assert.equal(itemKey("  BOND paper,  A4 - 70gsm "), "bond paper a4 70gsm");
  assert.equal(findItem(cat, { description: "Bond Paper A4 70GSM" }).stockNo, "OS-0009", "the latest delivery wins");
  assert.equal(findItem(cat, { description: "laptop computer 14 inch" }).stockNo, "ICT-014");
  assert.equal(findItem(cat, { description: "Ballpen" }), null, "drafts don't count");
  assert.equal(findItem(cat, { stockNo: "ict-014" }).description, "Laptop computer, 14-inch");
  assert.equal(findItem(cat, { description: "Stapler" }), null);
});
