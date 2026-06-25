import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMoney, formatRate, fromCents, toCents } from "./money.ts";

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

// formatMoney renders integer cents for display in the given locale: grouped
// thousands, 2 decimals, locale-correct decimal mark. No currency symbol —
// callers append € / EUR / ARS. Contract pinned against Intl.NumberFormat.

test("formatMoney es: comma decimal, period grouping", () => {
  assert.equal(formatMoney(4500000, "es"), "45.000,00");
  assert.equal(formatMoney(2744, "es"), "27,44");
  assert.equal(formatMoney(0, "es"), "0,00");
});

test("formatMoney en: period decimal, comma grouping", () => {
  assert.equal(formatMoney(4500000, "en"), "45,000.00");
  assert.equal(formatMoney(2744, "en"), "27.44");
  assert.equal(formatMoney(0, "en"), "0.00");
});

test("formatMoney: es leaves 4-digit integers ungrouped (RAE), en groups them", () => {
  assert.equal(formatMoney(167500, "es"), "1675,00");
  assert.equal(formatMoney(167500, "en"), "1,675.00");
});

test("formatMoney: negatives keep sign with the locale decimal", () => {
  assert.equal(formatMoney(-1220, "es"), "-12,20");
  assert.equal(formatMoney(-1220, "en"), "-12.20");
});

// formatRate renders an FX rate (real ARS-per-EUR ratio, NOT cents): same grouped/2-decimal
// locale rules as formatMoney but without the /100, so every rate reads uniformly.
test("formatRate normalises FX rates to grouped thousands + 2 decimals", () => {
  assert.equal(formatRate(1050, "en"), "1,050.00");
  assert.equal(formatRate(1187.5, "en"), "1,187.50");
  assert.equal(formatRate(1050, "es"), "1050,00"); // RAE: 4-digit integers ungrouped
  assert.equal(formatRate(1234567.5, "es"), "1.234.567,50");
});
