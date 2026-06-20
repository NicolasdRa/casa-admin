import assert from "node:assert/strict";
import { test } from "node:test";
import { bnaAverage, commissionEur, resolveRate, snapshot } from "./fx.ts";

test("bnaAverage = (compra + venta) / 2", () => {
  assert.equal(bnaAverage(1000, 1100), 1050);
});

test("EUR entry: ARS derived, EUR preserved", () => {
  // 100.00 EUR at 1050 ARS/EUR -> 105000.00 ARS
  assert.deepEqual(snapshot(10000, "EUR", 1050), { amountEur: 10000, amountArs: 10500000 });
});

test("ARS entry: EUR derived and rounded, ARS preserved", () => {
  // 105000.00 ARS at 1050 -> 100.00 EUR
  assert.deepEqual(snapshot(10500000, "ARS", 1050), { amountArs: 10500000, amountEur: 10000 });
  // rounding: 12345 ARS cents / 1050 = 11.757... -> 12 cents
  assert.equal(snapshot(12345, "ARS", 1050).amountEur, 12);
});

test("commission rounds to nearest cent", () => {
  assert.equal(commissionEur(10000, 0.1), 1000);
  assert.equal(commissionEur(9999, 0.1), 1000); // 999.9 -> 1000
});

test("guards reject bad input", () => {
  assert.throws(() => snapshot(100.5, "EUR", 1050));
  assert.throws(() => snapshot(100, "EUR", 0));
});

// FX-3: pick the BNA rate for an entry date, defaulting to the latest quote on/before it.
const rates = [
  { date: "2026-06-15", average: 1000 },
  { date: "2026-06-18", average: 1050 }, // Thursday
  { date: "2026-06-19", average: 1075 }, // Friday — last quote before the weekend
];

test("resolveRate: exact date match", () => {
  assert.deepEqual(resolveRate("2026-06-18", rates), { date: "2026-06-18", average: 1050 });
});

test("resolveRate: weekend falls back to the latest prior quote", () => {
  // Sat/Sun have no BNA quote -> use Friday's
  assert.deepEqual(resolveRate("2026-06-20", rates), { date: "2026-06-19", average: 1075 });
});

test("resolveRate: input order does not matter", () => {
  const shuffled = [rates[2], rates[0], rates[1]];
  assert.deepEqual(resolveRate("2026-06-20", shuffled), { date: "2026-06-19", average: 1075 });
});

test("resolveRate: date before all quotes -> null", () => {
  assert.equal(resolveRate("2026-06-01", rates), null);
});

test("resolveRate: empty table -> null", () => {
  assert.equal(resolveRate("2026-06-20", []), null);
});
