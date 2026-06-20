import assert from "node:assert/strict";
import { test } from "node:test";
import { createExpense, listExpenses } from "./expenses.ts";
import { upsertFxRate } from "./fx.ts";
import { makeTestDb } from "./testdb.ts";

function dbWithRates() {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1100 }); // avg 1050
  return db;
}

test("createExpense snapshots FX and stores both currencies", () => {
  const db = dbWithRates();
  const e = createExpense(db, {
    date: "2026-06-18",
    currency: "ARS",
    amount: 5250000, // 52 500.00 ARS
    detail: "Gas",
  });
  assert.equal(e.amountArs, 5250000); // entered side preserved
  assert.equal(e.amountEur, 5000); // 52 500.00 / 1050 = 50.00 EUR
  assert.equal(e.fxRate, 1050);
  assert.equal(e.fxRateDate, "2026-06-18");
  assert.equal(e.detail, "Gas");
  assert.ok(e.id > 0);
});

test("createExpense throws when no FX rate exists on/before the date", () => {
  const db = dbWithRates();
  assert.throws(() => createExpense(db, { date: "2020-01-01", currency: "EUR", amount: 100 }));
});

test("listExpenses returns rows newest-first", () => {
  const db = dbWithRates();
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 100, detail: "A" });
  upsertFxRate(db, { date: "2026-06-19", compra: 1180, venta: 1220 });
  createExpense(db, { date: "2026-06-19", currency: "EUR", amount: 100, detail: "B" });
  const all = listExpenses(db);
  assert.equal(all.length, 2);
  assert.equal(all[0].detail, "B");
});
