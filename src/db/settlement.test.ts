import assert from "node:assert/strict";
import { test } from "node:test";
import { createBooking } from "./bookings.ts";
import { createCashEntry, listCashLedger, registerBookingPayment } from "./cash.ts";
import { createExpense, getExpenseById, markExpenseReimbursed } from "./expenses.ts";
import { upsertFxRate } from "./fx.ts";
import { createPartner } from "./partners.ts";
import * as schema from "./schema.ts";
import { backfillSettleExpenses, ownerSettlement, settleExpense } from "./settlement.ts";
import { makeTestDb } from "./testdb.ts";
import { createUser } from "./users.ts";

// Two owners (50/50), each with an owner-user, plus a co-host (no partner mapping).
function setup() {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1100 });
  const nico = createPartner(db, { name: "Nicolás", defaultShare: 0.5 });
  const ana = createPartner(db, { name: "Anastasia", defaultShare: 0.5 });
  const uNico = createUser(db, {
    name: "Nicolás",
    email: "n@x.test",
    passwordHash: "h",
    role: "admin",
    partnerId: nico.id,
  });
  const uAna = createUser(db, {
    name: "Anastasia",
    email: "a@x.test",
    passwordHash: "h",
    role: "admin",
    partnerId: ana.id,
  });
  const cohost = createUser(db, {
    name: "Co-host",
    email: "c@x.test",
    passwordHash: "h",
    role: "user",
  });
  const eur = (cents: number, paidByUserId?: number) =>
    createExpense(db, { date: "2026-06-18", currency: "EUR", amount: cents, paidByUserId });
  return { db, nico, ana, uNico, uAna, cohost, eur };
}

const net = (r: ReturnType<typeof ownerSettlement>, partnerId: number) =>
  r.owners.find((o) => o.partnerId === partnerId)!;

test("50/50, one owner fronts everything → ±half, sums to zero (CA-77)", () => {
  const { db, nico, ana, uNico, eur } = setup();
  eur(10000, uNico.id);
  eur(20000, uNico.id); // Nicolás fronts 300.00 total
  const r = ownerSettlement(db);
  assert.equal(net(r, nico.id).fairShare, 15000);
  assert.equal(net(r, nico.id).fronted, 30000);
  assert.equal(net(r, nico.id).expenseNet, 15000);
  assert.equal(net(r, ana.id).expenseNet, -15000);
  assert.equal(
    r.owners.reduce((s, o) => s + o.expenseNet, 0),
    0,
  );
});

test("odd cent: fair share allocation never loses a cent (CA-77)", () => {
  const { db, uNico, eur } = setup();
  eur(10001, uNico.id); // 100.01 → 50.00 / 50.01 (largest remainder)
  const r = ownerSettlement(db);
  assert.equal(
    r.owners.reduce((s, o) => s + o.fairShare, 0),
    10001,
  );
  assert.equal(
    r.owners.reduce((s, o) => s + o.expenseNet, 0),
    0,
  );
});

test("reimbursed co-host expense is fronted by the reimbursing owner (EX-9 → CA-77)", () => {
  const { db, nico, ana, uAna, cohost, eur } = setup();
  const e = eur(4000, cohost.id); // co-host fronts; pending → not in the pool yet
  let r = ownerSettlement(db);
  assert.equal(net(r, nico.id).fronted, 0);
  assert.equal(net(r, ana.id).fronted, 0);
  // Anastasia (owner) reimburses → cost transfers to her
  markExpenseReimbursed(db, e.id, uAna.id, "2026-06-20");
  r = ownerSettlement(db);
  assert.equal(net(r, ana.id).fronted, 4000);
  assert.equal(net(r, ana.id).expenseNet, 2000); // 4000 fronted − 2000 fair share
  assert.equal(net(r, nico.id).expenseNet, -2000);
});

test("null-payer expenses are excluded and counted as unattributed (CA-77)", () => {
  const { db, nico, eur } = setup();
  eur(5000); // no payer
  eur(300); // no payer
  const r = ownerSettlement(db);
  assert.equal(net(r, nico.id).fairShare, 0); // nothing attributed → empty pool
  assert.equal(r.unattributed.count, 2);
  assert.equal(r.unattributed.totalEur, 5300);
});

test("cashAccount is computed from cash_entries as a separate line (CA-77)", () => {
  const { db, nico, ana } = setup();
  db.insert(schema.cashEntries)
    .values([
      {
        date: "2026-06-18",
        partnerId: nico.id,
        concept: "aporte",
        amountEur: 50000,
        type: "contribution",
      },
      {
        date: "2026-06-19",
        partnerId: nico.id,
        concept: "retiro",
        amountEur: -20000,
        type: "withdrawal",
      },
    ])
    .run();
  const r = ownerSettlement(db);
  assert.equal(net(r, nico.id).cashAccount, 30000); // 500 − 200
  assert.equal(net(r, ana.id).cashAccount, 0);
  // cash account is independent of the (empty) expense settlement
  assert.equal(net(r, nico.id).expenseNet, 0);
});

test("settleExpense repays the paying owner for one expense via a cash withdrawal (EX-12)", () => {
  const { db, nico, ana, uNico, eur } = setup();
  const e = eur(20000, uNico.id); // Nicolás fronts 200.00 on one expense

  let r = ownerSettlement(db);
  assert.equal(net(r, nico.id).fronted, 20000);
  assert.equal(net(r, nico.id).cashAccount, 0);

  const res = settleExpense(db, e.id, "2026-06-21");
  // the cash line is dated when the money leaves the box (settlement date), as a withdrawal
  assert.equal(res?.entry.date, "2026-06-21");
  assert.equal(res?.entry.type, "withdrawal");
  assert.equal(res?.entry.amountEur, -20000);
  // the expense is marked reimbursed so it can't be settled twice
  assert.equal(getExpenseById(db, e.id)?.reimbursedAt, "2026-06-21");

  r = ownerSettlement(db);
  assert.equal(net(r, nico.id).fronted, 20000); // historical, unchanged
  assert.equal(net(r, nico.id).cashAccount, -20000); // repayment cancels the fronted credit
  // Nicolás no longer a standalone creditor — both owners just bear their fair share
  assert.equal(net(r, nico.id).expenseNet + net(r, nico.id).cashAccount, -10000);
  assert.equal(net(r, ana.id).expenseNet, -10000);

  // idempotent — a second settle on the same expense is a no-op
  assert.equal(settleExpense(db, e.id, "2026-06-22"), null);
});

test("settleExpense refuses a co-host-paid expense (that's the reimburse flow) (EX-12)", () => {
  const { db, cohost, eur } = setup();
  const e = eur(4000, cohost.id); // co-host has no partner mapping
  assert.equal(settleExpense(db, e.id, "2026-06-21"), null);
});

test("backfillSettleExpenses settles every owner-fronted expense, dated its own date (EX-12)", () => {
  const { db, uNico, cohost } = setup();
  upsertFxRate(db, { date: "2024-01-10", compra: 1000, venta: 1100 });
  upsertFxRate(db, { date: "2024-03-05", compra: 1000, venta: 1100 });
  const e1 = createExpense(db, {
    date: "2024-01-10",
    currency: "EUR",
    amount: 10000,
    paidByUserId: uNico.id,
  });
  const e2 = createExpense(db, {
    date: "2024-03-05",
    currency: "EUR",
    amount: 5000,
    paidByUserId: uNico.id,
  });
  createExpense(db, { date: "2024-01-10", currency: "EUR", amount: 999, paidByUserId: cohost.id }); // co-host → skipped

  // dry run counts but writes nothing
  const dry = backfillSettleExpenses(db, { apply: false });
  assert.equal(dry.count, 2);
  assert.equal(dry.totalEur, 15000);
  assert.equal(getExpenseById(db, e1.id)?.reimbursedAt, null);
  assert.equal(listCashLedger(db).length, 0);

  // apply: each expense settled, cash entry dated the expense's OWN date
  const res = backfillSettleExpenses(db, { apply: true });
  assert.equal(res.count, 2);
  assert.equal(getExpenseById(db, e1.id)?.reimbursedAt, "2024-01-10");
  assert.equal(getExpenseById(db, e2.id)?.reimbursedAt, "2024-03-05");
  const ledger = listCashLedger(db);
  assert.equal(ledger.length, 2);
  assert.deepEqual(
    ledger.map((l) => [l.date, l.amountEur]).sort(),
    [
      ["2024-01-10", -10000],
      ["2024-03-05", -5000],
    ].sort(),
  );

  // idempotent — a second run finds nothing left
  assert.equal(backfillSettleExpenses(db, { apply: true }).count, 0);
});

test("backfillSettleExpenses force rewrites a wrongly-dated settle to the expense date, no dup (EX-12)", () => {
  const { db, uNico } = setup();
  upsertFxRate(db, { date: "2024-02-02", compra: 1000, venta: 1100 });
  const e = createExpense(db, {
    date: "2024-02-02",
    currency: "EUR",
    amount: 5000,
    paidByUserId: uNico.id,
  });
  // simulate a UI settle dated today (the wrong date we want to fix)
  settleExpense(db, e.id, "2026-06-21");
  assert.equal(getExpenseById(db, e.id)?.reimbursedAt, "2026-06-21");
  assert.equal(listCashLedger(db).length, 1);

  // a plain re-run is idempotent — it skips the already-settled expense, leaving the wrong date
  assert.equal(backfillSettleExpenses(db, { apply: true }).count, 0);
  assert.equal(getExpenseById(db, e.id)?.reimbursedAt, "2026-06-21");

  // force: wipes prior settle artifacts and rewrites — one entry, dated the expense date
  const res = backfillSettleExpenses(db, { apply: true, force: true });
  assert.equal(res.count, 1);
  assert.equal(getExpenseById(db, e.id)?.reimbursedAt, "2024-02-02");
  const ledger = listCashLedger(db);
  assert.equal(ledger.length, 1); // no duplicate left behind
  assert.equal(ledger[0].date, "2024-02-02");
  assert.equal(ledger[0].amountEur, -5000);
});

test("a registered cobro is Caja-visible but excluded from the settlement cashAccount (no double-count)", () => {
  const { db, nico, ana } = setup();
  // €1000 booking on a date with an FX rate; collected into Nicolás's account.
  const b = createBooking(db, {
    guest: "García",
    date: "2026-06-18",
    currency: "EUR",
    amount: 100_000,
    commissionRate: 0,
  });
  registerBookingPayment(db, { bookingId: b.id, partnerId: nico.id, date: "2026-06-18" });
  // A real own-money contribution from Anastasia, to prove non-income cash still counts.
  createCashEntry(db, {
    date: "2026-06-18",
    partnerId: ana.id,
    concept: "Aporte",
    amountEur: 30_000,
    type: "contribution",
  });

  const r = ownerSettlement(db);
  assert.equal(net(r, nico.id).cashAccount, 0); // the €1000 cobro does NOT inflate his claim
  assert.equal(net(r, ana.id).cashAccount, 30_000); // ordinary contribution still counts

  // …but the cobro is present in the Caja running balance: 1000 (income) + 300 (contribution).
  assert.equal(listCashLedger(db).length, 2);
  assert.equal(listCashLedger(db).at(-1)?.runningBalance, 130_000);
});
