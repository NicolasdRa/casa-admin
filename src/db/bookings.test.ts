import assert from "node:assert/strict";
import { test } from "node:test";
import { createBooking, listBookings } from "./bookings.ts";
import { upsertFxRate } from "./fx.ts";
import { makeTestDb } from "./testdb.ts";

function dbWithRates() {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1100 }); // avg 1050
  upsertFxRate(db, { date: "2026-06-19", compra: 1180, venta: 1220 }); // Fri, avg 1200
  return db;
}

test("createBooking snapshots FX + commission for an EUR booking", () => {
  const db = dbWithRates();
  const b = createBooking(db, {
    guest: "García",
    date: "2026-06-18",
    currency: "EUR",
    amount: 10000,
  });
  assert.equal(b.amountEur, 10000); // entered side preserved
  assert.equal(b.amountArs, 10500000); // 100.00 EUR * 1050
  assert.equal(b.fxRate, 1050);
  assert.equal(b.fxRateDate, "2026-06-18");
  assert.equal(b.commissionRate, 0.1);
  assert.equal(b.commissionEur, 1000); // 10% of 100.00 EUR
  assert.equal(b.type, "booking");
  assert.ok(b.id > 0);
});

test("createBooking on a weekend uses the latest prior rate (snapshotted)", () => {
  const db = dbWithRates();
  // 2026-06-21 is Sunday -> falls back to Friday 2026-06-19 (avg 1200)
  const b = createBooking(db, {
    guest: "Wknd",
    date: "2026-06-21",
    currency: "ARS",
    amount: 12000000,
  });
  assert.equal(b.fxRate, 1200);
  assert.equal(b.fxRateDate, "2026-06-19");
  assert.equal(b.amountArs, 12000000); // entered side preserved
  assert.equal(b.amountEur, 10000); // 120000.00 ARS / 1200
});

test("createBooking respects a custom commission rate", () => {
  const db = dbWithRates();
  const b = createBooking(db, {
    guest: "Co",
    date: "2026-06-18",
    currency: "EUR",
    amount: 20000,
    commissionRate: 0.15,
  });
  assert.equal(b.commissionRate, 0.15);
  assert.equal(b.commissionEur, 3000); // 15% of 200.00
});

test("createBooking throws when no FX rate exists on/before the date", () => {
  const db = dbWithRates();
  assert.throws(() =>
    createBooking(db, { guest: "X", date: "2026-01-01", currency: "EUR", amount: 100 }),
  );
});

test("listBookings returns rows newest-first", () => {
  const db = dbWithRates();
  createBooking(db, { guest: "First", date: "2026-06-18", currency: "EUR", amount: 100 });
  createBooking(db, { guest: "Second", date: "2026-06-19", currency: "EUR", amount: 100 });
  const all = listBookings(db);
  assert.equal(all.length, 2);
  assert.equal(all[0].guest, "Second");
});
