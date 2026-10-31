import { test } from "node:test";
import assert from "node:assert/strict";
import { formatStardate, stardate } from "../shared/stardate.js";

test("stardates follow the TNG fan formula: 1000 per year from 2323", () => {
  assert.equal(stardate(new Date(2323, 0, 1)), 0);
  assert.equal(stardate(new Date(2364, 0, 1)), 41000);
  assert.equal(formatStardate(new Date(2026, 0, 1)), "-297000.0");
  // Late October 2026 is about 83% through the year.
  assert.equal(formatStardate(new Date(2026, 9, 31, 12)), "-296168.5");
  assert.ok(stardate(new Date(2026, 11, 31, 23, 59)) < stardate(new Date(2027, 0, 1)));
});
