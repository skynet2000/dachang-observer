// Publishers print complete English dates with a comma after the month, or compact fourteen-digit
// wall-clock timestamps. Both must retain the source zone and reject rolled-over dates and times.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLooseDate } from "@aihot/backend/sources/dates";

test("a Chinese publication byline keeps the time printed in hours and minutes", () => {
  assert.equal(parseLooseDate("2026年11月03日 19时05分", "+08:00")?.toISOString(), "2026-11-03T11:05:00.000Z");
  assert.equal(parseLooseDate("2026年11月03日 19时05分23秒", "+08:00")?.toISOString(), "2026-11-03T11:05:23.000Z");
  assert.equal(parseLooseDate("2026年11月03日 25时05分"), null);
});

test("complete day-month-year dates accept the publisher's punctuation", () => {
  assert.equal(parseLooseDate("07 October, 2026", "+04:00")?.toISOString(), "2026-10-06T20:00:00.000Z");
  assert.equal(parseLooseDate("Published 07 October, 2026", "+08:00")?.toISOString(), "2026-10-06T16:00:00.000Z");
  assert.equal(parseLooseDate("October 7, 2026", "+00:00")?.toISOString(), "2026-10-07T00:00:00.000Z");
  for (const value of ["31 April, 2026", "29 February, 2026", "07 Never, 2026", "October, 2026"]) assert.equal(parseLooseDate(value), null, value);
});

test("compact publication timestamps retain wall-clock seconds without accepting version numbers or invalid dates", () => {
  assert.equal(parseLooseDate("20260930210715", "+08:00")?.toISOString(), "2026-09-30T13:07:15.000Z");
  for (const value of ["20260230210715", "20260930250715", "20260930216015", "20260930210760", "202609302107", "version 20260930210715"]) assert.equal(parseLooseDate(value), null, value);
});
