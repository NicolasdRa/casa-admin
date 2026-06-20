import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createExpense,
  expenseTotalsByPartner,
  getExpenseById,
  listExpenses,
  safeExt,
  setExpenseReceipt,
} from "./expenses.ts";
import { upsertFxRate } from "./fx.ts";
import { createPartner } from "./partners.ts";
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

test("safeExt extracts a lowercase extension or empty (EX-6)", () => {
  assert.equal(safeExt("scan.PDF"), "pdf");
  assert.equal(safeExt("a.b.jpeg"), "jpeg");
  assert.equal(safeExt("noext"), "");
  assert.equal(safeExt("../../etc/passwd"), ""); // no extension -> empty, no traversal token kept
});

test("setExpenseReceipt attaches a receipt to an expense (EX-6)", () => {
  const db = dbWithRates();
  const e = createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 5000 });
  setExpenseReceipt(db, e.id, "receipt-1.pdf");
  assert.equal(getExpenseById(db, e.id)?.receiptUrl, "receipt-1.pdf");
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

function dbWithRatesAndPartners() {
  const db = dbWithRates();
  createPartner(db, { name: "Nicolás", defaultShare: 0.5 });
  createPartner(db, { name: "Anastasia", defaultShare: 0.5 });
  return db;
}

test("createExpense splits the EUR total across partners (sums exactly)", () => {
  const db = dbWithRatesAndPartners();
  const e = createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 10001 }); // 100.01 EUR
  const totals = expenseTotalsByPartner(db);
  assert.equal(totals.length, 2);
  assert.equal(
    totals.reduce((s, t) => s + t.totalEur, 0),
    e.amountEur, // 10001 — odd cent not lost
  );
});

test("createExpense without partners records no splits (graceful)", () => {
  const db = dbWithRates(); // no partners
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 5000 });
  assert.equal(expenseTotalsByPartner(db).length, 0);
});

test("expenseTotalsByPartner aggregates across expenses", () => {
  const db = dbWithRatesAndPartners();
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 10000 });
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 20000 });
  const totals = expenseTotalsByPartner(db);
  // 50/50 of 300.00 EUR -> 150.00 each
  assert.deepEqual(
    totals.map((t) => t.totalEur).sort((a, b) => a - b),
    [15000, 15000],
  );
});
