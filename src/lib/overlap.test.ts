import assert from "node:assert/strict";
import { test } from "node:test";
import { rangesOverlap } from "./overlap.ts";

// Stays are half-open intervals [start, end): `end` is the check-out day, which is free for the
// next guest's check-in. ISO dates sort lexically, so plain string compares are date compares.

test("clearly overlapping ranges conflict", () => {
  assert.equal(rangesOverlap("2026-07-01", "2026-07-05", "2026-07-03", "2026-07-08"), true);
});

test("fully disjoint ranges do not conflict", () => {
  assert.equal(rangesOverlap("2026-07-01", "2026-07-05", "2026-07-10", "2026-07-12"), false);
});

test("same-day turnover does NOT conflict (A checks out the day B checks in)", () => {
  assert.equal(rangesOverlap("2026-07-01", "2026-07-05", "2026-07-05", "2026-07-08"), false);
  assert.equal(rangesOverlap("2026-07-05", "2026-07-08", "2026-07-01", "2026-07-05"), false);
});

test("one range fully inside another conflicts", () => {
  assert.equal(rangesOverlap("2026-07-01", "2026-07-31", "2026-07-10", "2026-07-12"), true);
});

test("single shared night conflicts", () => {
  assert.equal(rangesOverlap("2026-07-01", "2026-07-06", "2026-07-05", "2026-07-10"), true);
});

// gapDays: require N clear days between stays (e.g. a cleaning/buffer day). A = Jul 1 → 5.
test("gapDays=1 turns same-day turnover into a conflict", () => {
  // check-in on the 5th: no buffer day → conflict
  assert.equal(rangesOverlap("2026-07-01", "2026-07-05", "2026-07-05", "2026-07-08", 1), true);
  // check-in on the 6th: the 5th is the buffer → OK
  assert.equal(rangesOverlap("2026-07-01", "2026-07-05", "2026-07-06", "2026-07-08", 1), false);
});

test("gapDays is symmetric (B before A)", () => {
  // B ends Jul 5; with gap 1 the 5th is the buffer, so A check-in on the 5th conflicts, 6th is clear.
  assert.equal(rangesOverlap("2026-07-05", "2026-07-08", "2026-07-01", "2026-07-05", 1), true);
  assert.equal(rangesOverlap("2026-07-06", "2026-07-08", "2026-07-01", "2026-07-05", 1), false);
});

test("gapDays handles month rollover", () => {
  // A ends Jul 31, gap 2 → blocks check-ins on Jul 31, Aug 1; Aug 2 is clear.
  assert.equal(rangesOverlap("2026-07-28", "2026-07-31", "2026-08-01", "2026-08-04", 2), true);
  assert.equal(rangesOverlap("2026-07-28", "2026-07-31", "2026-08-02", "2026-08-04", 2), false);
});
