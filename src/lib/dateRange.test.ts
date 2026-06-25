import assert from "node:assert/strict";
import { test } from "node:test";
import { inDateRange } from "./dateRange.ts";

// ISO dates are YYYY-MM-DD, so a lexical compare is chronological. Bounds are inclusive;
// an empty/undefined bound leaves that side open.
test("inDateRange: inclusive bounds and open sides", () => {
  assert.equal(inDateRange("2026-06-15", "2026-06-01", "2026-06-30"), true);
  assert.equal(inDateRange("2026-06-01", "2026-06-01", "2026-06-30"), true); // inclusive lower
  assert.equal(inDateRange("2026-06-30", "2026-06-01", "2026-06-30"), true); // inclusive upper
  assert.equal(inDateRange("2026-05-31", "2026-06-01", "2026-06-30"), false);
  assert.equal(inDateRange("2026-07-01", "2026-06-01", "2026-06-30"), false);

  assert.equal(inDateRange("2026-06-15", "", ""), true); // unbounded both sides
  assert.equal(inDateRange("2026-06-15", "2026-06-20", ""), false); // from-only excludes earlier
  assert.equal(inDateRange("2026-06-25", "2026-06-20", ""), true); // from-only includes later
  assert.equal(inDateRange("2026-06-15", "", "2026-06-10"), false); // to-only excludes later
});
