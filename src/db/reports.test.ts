import assert from "node:assert/strict";
import { test } from "node:test";
import { createBooking } from "./bookings.ts";
import { commissionBalance, createCommissionSettlement } from "./commission.ts";
import { createCategory, createExpense } from "./expenses.ts";
import { upsertFxRate } from "./fx.ts";
import {
  annualPnl,
  biMonetaryEntries,
  incomeVsExpenseByMonth,
  multiYearBalance,
} from "./reports.ts";
import { makeTestDb } from "./testdb.ts";

function seeded() {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2025-06-18", compra: 1000, venta: 1100 }); // avg 1050
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1100 });
  const cat = createCategory(db, { name: "Luz", group: "operating" });
  createBooking(db, { guest: "G", date: "2026-06-18", currency: "EUR", amount: 30000 }); // income 30000, comm 3000
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 10000, categoryId: cat.id });
  createBooking(db, { guest: "H", date: "2025-06-18", currency: "EUR", amount: 20000 }); // income 20000, comm 2000
  return db;
}

test("annualPnl: income, commission, expenses by group, net (RP-1)", () => {
  const p = annualPnl(seeded(), "2026");
  assert.equal(p.income, 30000);
  assert.equal(p.commission, 3000);
  assert.equal(p.totalExpenses, 10000);
  assert.equal(p.netResult, 17000); // 30000 - 3000 - 10000
  assert.deepEqual(p.expensesByGroup, [{ group: "operating", eur: 10000 }]);
});

test("multiYearBalance: per-year net with running cumulative (RP-2)", () => {
  const bal = multiYearBalance(seeded(), "2023");
  assert.equal(bal.length, 2);
  assert.deepEqual(
    bal.map((b) => [b.year, b.net, b.cumulative]),
    [
      ["2025", 18000, 18000], // 20000 - 2000
      ["2026", 17000, 35000],
    ],
  );
});

test("biMonetaryEntries: unified ARS/EUR/FX rows newest-first (RP-3)", () => {
  const rows = biMonetaryEntries(seeded());
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, "2026-06-18");
  assert.ok(rows.every((r) => r.fxRate === 1050 && r.eur > 0 && r.ars > 0));
});

test("incomeVsExpenseByMonth groups by month (RP-6)", () => {
  const m = incomeVsExpenseByMonth(seeded());
  assert.deepEqual(m, [
    { month: "2025-06", income: 20000, expense: 0 },
    { month: "2026-06", income: 30000, expense: 10000 },
  ]);
});

test("commissionBalance: accrued - settled = owed (RP-7)", () => {
  const db = seeded();
  createCommissionSettlement(db, { date: "2026-06-19", amountEur: 1000 });
  assert.deepEqual(commissionBalance(db), { accrued: 5000, settled: 1000, owed: 4000 });
});
