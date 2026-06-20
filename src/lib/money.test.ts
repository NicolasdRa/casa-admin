import assert from "node:assert/strict";
import { test } from "node:test";
import { fromCents, toCents } from "./money.ts";

test("toCents converts major units to integer cents, rounding sub-cent input", () => {
  assert.equal(toCents(100), 10000);
  assert.equal(toCents(100.5), 10050);
  assert.equal(toCents(99.99), 9999);
  assert.equal(toCents(0.07), 7); // 0.07 * 100 = 7.0000000000000009 -> 7
});

test("toCents rejects non-finite input (e.g. empty form field -> NaN)", () => {
  assert.throws(() => toCents(Number.NaN));
  assert.throws(() => toCents(Number.POSITIVE_INFINITY));
});

test("fromCents is the inverse for display", () => {
  assert.equal(fromCents(10050), 100.5);
  assert.equal(fromCents(7), 0.07);
});
