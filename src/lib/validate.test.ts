import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCurrency, assertIsoDate, assertPositiveCents } from "./validate.ts";

test("assertIsoDate accepts real dates, rejects malformed and impossible ones", () => {
  assert.equal(assertIsoDate("2026-06-20"), "2026-06-20");
  assert.throws(() => assertIsoDate("2026-13-01")); // month 13
  assert.throws(() => assertIsoDate("2026-02-30")); // Feb 30
  assert.throws(() => assertIsoDate("2026-6-1")); // not zero-padded
  assert.throws(() => assertIsoDate("nope"));
});

test("assertCurrency narrows to ARS|EUR, rejects others", () => {
  assert.equal(assertCurrency("EUR"), "EUR");
  assert.equal(assertCurrency("ARS"), "ARS");
  assert.throws(() => assertCurrency("USD"));
});

test("assertPositiveCents requires a positive integer", () => {
  assert.equal(assertPositiveCents(150), 150);
  assert.throws(() => assertPositiveCents(0));
  assert.throws(() => assertPositiveCents(-5));
  assert.throws(() => assertPositiveCents(1.5));
});
