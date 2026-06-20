import assert from "node:assert/strict";
import { test } from "node:test";
import { createBooking } from "./bookings.ts";
import { createCashEntry } from "./cash.ts";
import { createExpense } from "./expenses.ts";
import { upsertFxRate } from "./fx.ts";
import { createPartner } from "./partners.ts";
import { partnerStatements } from "./statements.ts";
import { makeTestDb } from "./testdb.ts";
import { createUser } from "./users.ts";

test("partnerStatements combines income/commission/expense shares, settlement net and cash", () => {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1100 }); // avg 1050
  const a = createPartner(db, { name: "A", defaultShare: 0.5 });
  const b = createPartner(db, { name: "B", defaultShare: 0.5 });
  const ua = createUser(db, {
    name: "A",
    email: "a@x.com",
    passwordHash: "h",
    role: "admin",
    partnerId: a.id,
  });
  createUser(db, {
    name: "B",
    email: "b@x.com",
    passwordHash: "h",
    role: "admin",
    partnerId: b.id,
  });

  createBooking(db, { guest: "G", date: "2026-06-18", currency: "EUR", amount: 30000 }); // income 30000, comm 3000 @10%
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 10000, paidByUserId: ua.id }); // A fronts 10000
  createCashEntry(db, {
    date: "2026-06-18",
    partnerId: a.id,
    concept: "Aporte",
    amountEur: 5000,
    type: "contribution",
  });

  const A = partnerStatements(db).find((s) => s.partnerId === a.id);
  assert.ok(A);
  assert.equal(A.incomeShare, 15000); // 30000 * 50%
  assert.equal(A.commissionShare, 1500); // 3000 * 50%
  assert.equal(A.expenseShare, 5000); // 10000 * 50%
  assert.equal(A.result, 8500); // 15000 - 1500 - 5000
  assert.equal(A.fronted, 10000);
  assert.equal(A.expenseNet, 5000); // fronted 10000 - fair 5000
  assert.equal(A.cashAccount, 5000);
});
