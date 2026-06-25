import assert from "node:assert/strict";
import { test } from "node:test";
import { createBooking } from "./bookings.ts";
import {
  commissionBalance,
  commissionBalanceByCoHost,
  createCommissionSettlement,
  deleteCommissionSettlement,
  listCommissionSettlements,
  settledCommissionEur,
  updateCommissionSettlement,
} from "./commission.ts";
import { upsertFxRate } from "./fx.ts";
import { makeTestDb } from "./testdb.ts";

function dbWithRates() {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1100 }); // avg 1050
  return db;
}

test("commissionBalance is zero on an empty book", () => {
  assert.deepEqual(commissionBalance(makeTestDb()), { accrued: 0, settled: 0, owed: 0 });
});

test("accrued commission sums booking commission; settlements reduce owed", () => {
  const db = dbWithRates();
  createBooking(db, { guest: "A", date: "2026-06-18", currency: "EUR", amount: 10000 }); // 10% → 1000
  createBooking(db, { guest: "B", date: "2026-06-18", currency: "EUR", amount: 20000 }); // 10% → 2000
  assert.deepEqual(commissionBalance(db), { accrued: 3000, settled: 0, owed: 3000 });

  createCommissionSettlement(db, { date: "2026-06-20", amountEur: 1200, note: "partial" });
  createCommissionSettlement(db, { date: "2026-06-21", amountEur: 800 });
  assert.equal(settledCommissionEur(db), 2000);
  assert.deepEqual(commissionBalance(db), { accrued: 3000, settled: 2000, owed: 1000 });
  // newest first, note preserved/nulled
  const rows = listCommissionSettlements(db);
  assert.equal(rows[0].date, "2026-06-21");
  assert.equal(rows[0].note, null);
  assert.equal(rows[1].note, "partial");
});

test("createCommissionSettlement rejects non-positive / non-integer amounts and bad dates", () => {
  const db = makeTestDb();
  assert.throws(() => createCommissionSettlement(db, { date: "2026-06-20", amountEur: 0 }));
  assert.throws(() => createCommissionSettlement(db, { date: "2026-06-20", amountEur: -5 }));
  assert.throws(() => createCommissionSettlement(db, { date: "2026-06-20", amountEur: 1.5 }));
  assert.throws(() => createCommissionSettlement(db, { date: "not-a-date", amountEur: 100 }));
});

test("updateCommissionSettlement edits date, amount and note; balance follows", () => {
  const db = makeTestDb();
  const row = createCommissionSettlement(db, {
    date: "2026-06-20",
    amountEur: 1200,
    note: "partial",
  });
  assert.equal(settledCommissionEur(db), 1200);

  const updated = updateCommissionSettlement(db, row.id, {
    date: "2026-06-22",
    amountEur: 900,
    note: "corrected",
  });
  assert.equal(updated.id, row.id);
  assert.equal(updated.date, "2026-06-22");
  assert.equal(updated.amountEur, 900);
  assert.equal(updated.note, "corrected");
  assert.equal(settledCommissionEur(db), 900); // edit replaces, not appends

  // note can be cleared
  const cleared = updateCommissionSettlement(db, row.id, { date: "2026-06-22", amountEur: 900 });
  assert.equal(cleared.note, null);
});

test("listCommissionSettlements filters by year and date range", () => {
  const db = makeTestDb();
  createCommissionSettlement(db, { date: "2025-12-31", amountEur: 100 });
  createCommissionSettlement(db, { date: "2026-03-15", amountEur: 200 });
  createCommissionSettlement(db, { date: "2026-09-01", amountEur: 300 });

  assert.equal(listCommissionSettlements(db).length, 3); // no filter → all
  assert.deepEqual(
    listCommissionSettlements(db, { year: "2026" }).map((r) => r.amountEur),
    [300, 200], // newest first, 2025 excluded
  );
  assert.deepEqual(
    listCommissionSettlements(db, { from: "2026-01-01", to: "2026-06-30" }).map((r) => r.amountEur),
    [200], // inclusive range; Sep and Dec out
  );
});

test("listCommissionSettlements filters by co-host", () => {
  const db = makeTestDb();
  createCommissionSettlement(db, { date: "2026-06-20", amountEur: 100, coHostUserId: 5 });
  createCommissionSettlement(db, { date: "2026-06-21", amountEur: 200, coHostUserId: 6 });
  const r = listCommissionSettlements(db, { coHostUserId: 5 });
  assert.deepEqual(
    r.map((x) => x.amountEur),
    [100],
  );
});

test("commissionBalanceByCoHost groups accrued + settled per co-host; null = unattributed", () => {
  const db = dbWithRates();
  createBooking(db, {
    guest: "A",
    date: "2026-06-18",
    currency: "EUR",
    amount: 10000,
    coHostUserId: 7,
  }); // 1000
  createBooking(db, {
    guest: "B",
    date: "2026-06-18",
    currency: "EUR",
    amount: 20000,
    coHostUserId: 8,
  }); // 2000
  createBooking(db, { guest: "C", date: "2026-06-18", currency: "EUR", amount: 5000 }); // 500, no co-host
  createCommissionSettlement(db, { date: "2026-06-20", amountEur: 600, coHostUserId: 7 });

  const byId = new Map(commissionBalanceByCoHost(db).map((r) => [r.coHostUserId, r]));
  assert.deepEqual(byId.get(7), { coHostUserId: 7, accrued: 1000, settled: 600, owed: 400 });
  assert.deepEqual(byId.get(8), { coHostUserId: 8, accrued: 2000, settled: 0, owed: 2000 });
  assert.deepEqual(byId.get(null), { coHostUserId: null, accrued: 500, settled: 0, owed: 500 });
  // global balance still equals the sum across co-hosts
  assert.deepEqual(commissionBalance(db), { accrued: 3500, settled: 600, owed: 2900 });
});

test("commission settlements store and update the target co-host", () => {
  const db = makeTestDb();
  const row = createCommissionSettlement(db, {
    date: "2026-06-20",
    amountEur: 500,
    coHostUserId: 7,
  });
  assert.equal(row.coHostUserId, 7);
  assert.equal(listCommissionSettlements(db)[0].coHostUserId, 7);

  const updated = updateCommissionSettlement(db, row.id, {
    date: "2026-06-20",
    amountEur: 500,
    coHostUserId: 9,
  });
  assert.equal(updated.coHostUserId, 9);

  // omitting it clears the relation (null), it doesn't silently keep the old value
  const cleared = updateCommissionSettlement(db, row.id, { date: "2026-06-20", amountEur: 500 });
  assert.equal(cleared.coHostUserId, null);
});

test("deleteCommissionSettlement removes a row; balance follows", () => {
  const db = makeTestDb();
  const a = createCommissionSettlement(db, { date: "2026-06-20", amountEur: 1200 });
  createCommissionSettlement(db, { date: "2026-06-21", amountEur: 800 });
  assert.equal(settledCommissionEur(db), 2000);

  deleteCommissionSettlement(db, a.id);
  assert.equal(settledCommissionEur(db), 800);
  assert.equal(listCommissionSettlements(db).length, 1);
});

test("updateCommissionSettlement rejects bad amounts/dates and a missing id", () => {
  const db = makeTestDb();
  const row = createCommissionSettlement(db, { date: "2026-06-20", amountEur: 1000 });
  assert.throws(() => updateCommissionSettlement(db, row.id, { date: "2026-06-20", amountEur: 0 }));
  assert.throws(() =>
    updateCommissionSettlement(db, row.id, { date: "2026-06-20", amountEur: -5 }),
  );
  assert.throws(() =>
    updateCommissionSettlement(db, row.id, { date: "2026-06-20", amountEur: 1.5 }),
  );
  assert.throws(() => updateCommissionSettlement(db, row.id, { date: "nope", amountEur: 100 }));
  assert.throws(() => updateCommissionSettlement(db, 9999, { date: "2026-06-20", amountEur: 100 }));
});
