import assert from "node:assert/strict";
import { test } from "node:test";
import { createBooking } from "./bookings.ts";
import {
  bookingPayments,
  createCashEntry,
  deleteCashEntry,
  editCashEntryDate,
  listCashLedger,
  paidBookingIds,
  registerBookingPayment,
} from "./cash.ts";
import { makeTestDb } from "./testdb.ts";

// A booking with a fixed manual FX rate so the test needs no fx_rates / settings rows.
function seedBooking(db: ReturnType<typeof makeTestDb>, amount = 100_00) {
  return createBooking(db, {
    guest: "García",
    date: "2026-03-10",
    currency: "EUR",
    amount, // EUR cents — EUR side preserved exactly, so amountEur === amount
    manualRate: 1000,
    commissionRate: 0.1,
  });
}

test("createCashEntry stores a signed entry; rejects empty concept", () => {
  const db = makeTestDb();
  const e = createCashEntry(db, {
    date: "2026-01-01",
    partnerId: 1,
    concept: "Aporte",
    amountEur: 5000,
    type: "contribution",
  });
  assert.equal(e.amountEur, 5000);
  assert.throws(() =>
    createCashEntry(db, {
      date: "2026-01-01",
      partnerId: 1,
      concept: " ",
      amountEur: 1,
      type: "contribution",
    }),
  );
});

test("listCashLedger returns a cumulative running balance in date order", () => {
  const db = makeTestDb();
  createCashEntry(db, {
    date: "2026-02-01",
    partnerId: 1,
    concept: "Retiro",
    amountEur: -2000,
    type: "withdrawal",
  });
  createCashEntry(db, {
    date: "2026-01-01",
    partnerId: 1,
    concept: "Aporte",
    amountEur: 5000,
    type: "contribution",
  });
  const led = listCashLedger(db);
  assert.equal(led[0].concept, "Aporte"); // earliest first
  assert.equal(led[0].runningBalance, 5000);
  assert.equal(led[1].runningBalance, 3000);
});

test("registerBookingPayment posts an income entry linked to the booking, defaulting to its EUR", () => {
  const db = makeTestDb();
  const b = seedBooking(db); // amountEur = 10000
  const e = registerBookingPayment(db, {
    bookingId: b.id,
    partnerId: 2,
    date: "2026-03-12",
  });
  assert.equal(e.type, "income");
  assert.equal(e.bookingId, b.id);
  assert.equal(e.partnerId, 2);
  assert.equal(e.amountEur, 10000); // defaulted from the booking, positive (cash in)
  assert.match(e.concept, /García/); // guest carried into the ledger concept
});

test("registerBookingPayment collects a cancellation-fee row too (not just rentals)", () => {
  const db = makeTestDb();
  // A cancellation row: real money in (the fee), so its receipt must be registrable like a rental.
  const c = createBooking(db, {
    guest: "Pérez",
    date: "2026-03-10",
    currency: "EUR",
    amount: 50_00,
    manualRate: 1000,
    type: "cancellation",
  });
  const e = registerBookingPayment(db, { bookingId: c.id, partnerId: 1, date: "2026-03-12" });
  assert.equal(e.type, "income");
  assert.equal(e.amountEur, 5000); // the fee, defaulted from the row
  assert.ok(paidBookingIds(db).has(c.id)); // now shows as collected
  assert.match(e.concept, /cancelaci/i); // type-aware default, not "Cobro alquiler"
});

test("registerBookingPayment collects a damage-compensation row too", () => {
  const db = makeTestDb();
  // A damage payment is a guest paying the owner for damage — real money in, the "damage" booking
  // type (distinct from co-host expense reimbursement). Its receipt must be registrable.
  const d = createBooking(db, {
    guest: "Anita — damage",
    date: "2026-03-10",
    currency: "EUR",
    amount: 80_00,
    manualRate: 1000,
    type: "damage",
  });
  const e = registerBookingPayment(db, { bookingId: d.id, partnerId: 1, date: "2026-03-12" });
  assert.equal(e.type, "income");
  assert.equal(e.amountEur, 8000);
  assert.ok(paidBookingIds(db).has(d.id));
  assert.match(e.concept, /daño/i); // type-aware default
});

test("registerBookingPayment is idempotent — a second registration for the same booking throws", () => {
  const db = makeTestDb();
  const b = seedBooking(db);
  registerBookingPayment(db, { bookingId: b.id, partnerId: 1, date: "2026-03-12" });
  assert.throws(
    () => registerBookingPayment(db, { bookingId: b.id, partnerId: 2, date: "2026-03-13" }),
    /already/i,
  );
  // and the partner balance only moved once
  assert.equal(listCashLedger(db).length, 1);
});

test("editCashEntryDate moves a registered cobro's date; rejects a malformed date", () => {
  const db = makeTestDb();
  const b = seedBooking(db);
  const e = registerBookingPayment(db, { bookingId: b.id, partnerId: 1, date: "2026-03-12" });
  const moved = editCashEntryDate(db, e.id, "2026-03-20");
  assert.equal(moved.date, "2026-03-20");
  assert.equal(moved.amountEur, e.amountEur); // only the date changes
  assert.throws(() => editCashEntryDate(db, e.id, "not-a-date"));
});

test("bookingPayments links each booking to its cash receipt (id + date)", () => {
  const db = makeTestDb();
  const b = seedBooking(db);
  registerBookingPayment(db, { bookingId: b.id, partnerId: 1, date: "2026-03-12" });
  const [p] = bookingPayments(db);
  assert.equal(p.bookingId, b.id);
  assert.equal(p.date, "2026-03-12");
  assert.ok(p.id > 0);
});

test("paidBookingIds reports which bookings already have a cash receipt", () => {
  const db = makeTestDb();
  const paid = seedBooking(db);
  const unpaid = seedBooking(db);
  registerBookingPayment(db, { bookingId: paid.id, partnerId: 1, date: "2026-03-12" });
  const ids = paidBookingIds(db);
  assert.ok(ids.has(paid.id));
  assert.ok(!ids.has(unpaid.id));
});

test("deleteCashEntry removes a mistyped entry; balance recomputes", () => {
  const db = makeTestDb();
  const keep = createCashEntry(db, {
    date: "2026-01-01",
    partnerId: 1,
    concept: "Aporte",
    amountEur: 5000,
    type: "contribution",
  });
  const oops = createCashEntry(db, {
    date: "2026-01-02",
    partnerId: 1,
    concept: "Error",
    amountEur: 9999,
    type: "contribution",
  });
  deleteCashEntry(db, oops.id);
  const led = listCashLedger(db);
  assert.equal(led.length, 1);
  assert.equal(led[0].id, keep.id);
  assert.equal(led[0].runningBalance, 5000);
});
