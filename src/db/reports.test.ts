import assert from "node:assert/strict";
import { test } from "node:test";
import { createBooking } from "./bookings.ts";
import { createCashEntry } from "./cash.ts";
import { commissionBalance, createCommissionSettlement } from "./commission.ts";
import { createCategory, createExpense } from "./expenses.ts";
import { upsertFxRate } from "./fx.ts";
import { createTask } from "./maintenance.ts";
import { createPartner } from "./partners.ts";
import {
  annualPnl,
  biMonetaryEntries,
  dashboardAttention,
  incomeVsExpenseByMonth,
  multiYearBalance,
  periodSummary,
} from "./reports.ts";
import { makeTestDb } from "./testdb.ts";
import { createUser } from "./users.ts";

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

test("annualPnl income includes cancellations & reimbursements; they accrue no commission", () => {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1100 });
  createBooking(db, { guest: "G", date: "2026-06-18", currency: "EUR", amount: 30000 });
  createBooking(db, {
    guest: "Cx",
    date: "2026-06-18",
    currency: "EUR",
    amount: 5000,
    type: "cancellation",
  });
  createBooking(db, {
    guest: "Dx",
    date: "2026-06-18",
    currency: "EUR",
    amount: 7000,
    type: "damage",
  });
  const p = annualPnl(db, "2026");
  assert.equal(p.income, 42000); // 30000 + 5000 cancellation + 7000 damage
  assert.equal(p.commission, 3000); // only the booking accrues commission
  assert.equal(p.netResult, 39000); // 42000 - 3000 - 0
});

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

test("multiYearBalance defaults to the earliest year present (no silent 2023 floor)", () => {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2022-12-22", compra: 200, venta: 220 });
  upsertFxRate(db, { date: "2025-06-18", compra: 1000, venta: 1100 });
  createBooking(db, { guest: "Early", date: "2022-12-22", currency: "EUR", amount: 40000 });
  createBooking(db, { guest: "H", date: "2025-06-18", currency: "EUR", amount: 20000 });
  const bal = multiYearBalance(db); // no fromYear → must not drop the 2022 booking
  assert.equal(bal[0].year, "2022");
  assert.equal(bal[0].income, 40000);
  assert.equal(
    bal.reduce((s, b) => s + b.income, 0),
    60000,
  ); // both years counted
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

test("periodSummary year: current year figures + prior-year comparison (CA-119 panel)", () => {
  const p = periodSummary(seeded(), "year", "2026-06-25");
  assert.equal(p.income, 30000);
  assert.equal(p.commission, 3000);
  assert.equal(p.expenses, 10000);
  assert.equal(p.netResult, 17000);
  assert.deepEqual(p.prev, { income: 20000, commission: 2000, expenses: 0, netResult: 18000 });
});

test("periodSummary month: current month only, prior month is the comparison", () => {
  const p = periodSummary(seeded(), "month", "2026-06-25");
  assert.equal(p.income, 30000); // the 2026-06 booking
  assert.equal(p.expenses, 10000);
  assert.deepEqual(p.prev, { income: 0, commission: 0, expenses: 0, netResult: 0 }); // 2026-05 empty
});

test("periodSummary month: comparison rolls over the year (Jan → prior Dec)", () => {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2025-12-10", compra: 1000, venta: 1100 });
  upsertFxRate(db, { date: "2026-01-10", compra: 1000, venta: 1100 });
  createBooking(db, { guest: "Dec", date: "2025-12-10", currency: "EUR", amount: 5000 });
  createBooking(db, { guest: "Jan", date: "2026-01-10", currency: "EUR", amount: 8000 });
  const p = periodSummary(db, "month", "2026-01-20");
  assert.equal(p.income, 8000); // January
  assert.equal(p.prev?.income, 5000); // prior December
});

test("periodSummary all: every row summed, no comparison", () => {
  const p = periodSummary(seeded(), "all", "2026-06-25");
  assert.equal(p.income, 50000); // 30000 + 20000 across both years
  assert.equal(p.commission, 5000);
  assert.equal(p.expenses, 10000);
  assert.equal(p.netResult, 35000);
  assert.equal(p.prev, null);
});

test("dashboardAttention: empty db is all zeros", () => {
  assert.deepEqual(dashboardAttention(makeTestDb(), "2026-06-25"), {
    maintenanceOpen: 0,
    cajaBalance: 0,
    upcomingCheckIns: 0,
    settlementDue: 0,
  });
});

test("dashboardAttention: open tasks, caja balance, 7-day check-ins, settlement due", () => {
  const db = makeTestDb();
  for (const d of ["2026-06-18", "2026-06-27", "2026-07-10"])
    upsertFxRate(db, { date: d, compra: 1000, venta: 1100 });

  // maintenance: 2 pending, 1 done → only pending count
  createTask(db, { date: "2026-06-20", description: "Fix gutter", season: "2026" });
  createTask(db, { date: "2026-06-21", description: "Service pool", season: "2026" });
  createTask(db, { date: "2026-06-22", description: "Done thing", season: "2026", status: "done" });

  // caja: +5000 then -1000 → running balance 4000
  const nico = createPartner(db, { name: "Nicolás", defaultShare: 0.5 });
  const ana = createPartner(db, { name: "Anastasia", defaultShare: 0.5 });
  createCashEntry(db, {
    date: "2026-06-01",
    partnerId: nico.id,
    concept: "seed",
    amountEur: 5000,
    type: "contribution",
  });
  createCashEntry(db, {
    date: "2026-06-10",
    partnerId: nico.id,
    concept: "draw",
    amountEur: -1000,
    type: "withdrawal",
  });

  // check-ins relative to 2026-06-25: 06-27 inside window, 07-10 outside, 06-18 in the past
  createBooking(db, { guest: "Soon", date: "2026-06-27", currency: "EUR", amount: 10000 });
  createBooking(db, { guest: "Later", date: "2026-07-10", currency: "EUR", amount: 10000 });
  createBooking(db, { guest: "Past", date: "2026-06-18", currency: "EUR", amount: 10000 });

  // settlement: Nicolás fronts a 10000 expense, 50/50 → +5000 owed back to him
  const uNico = createUser(db, {
    name: "Nicolás",
    email: "n@x.test",
    passwordHash: "h",
    role: "admin",
    partnerId: nico.id,
  });
  createUser(db, {
    name: "Anastasia",
    email: "a@x.test",
    passwordHash: "h",
    role: "admin",
    partnerId: ana.id,
  });
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 10000, paidByUserId: uNico.id });

  assert.deepEqual(dashboardAttention(db, "2026-06-25"), {
    maintenanceOpen: 2,
    cajaBalance: 4000,
    upcomingCheckIns: 1,
    settlementDue: 5000,
  });
});

test("commissionBalance: accrued - settled = owed (RP-7)", () => {
  const db = seeded();
  createCommissionSettlement(db, { date: "2026-06-19", amountEur: 1000 });
  assert.deepEqual(commissionBalance(db), { accrued: 5000, settled: 1000, owed: 4000 });
});
