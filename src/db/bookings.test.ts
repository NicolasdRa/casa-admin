import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accruedCommissionEur,
  createBooking,
  listBookings,
  occupancyByMonth,
  summarizeBookings,
} from "./bookings.ts";
import { upsertFxRate } from "./fx.ts";
import { updateSettings } from "./settings.ts";
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

test("createBooking accepts a manual FX rate when none exists, flagged overridden (FX-7)", () => {
  const db = dbWithRates();
  const b = createBooking(db, {
    guest: "Manual",
    date: "2026-01-01", // no BNA quote on/before this
    currency: "EUR",
    amount: 10000,
    manualRate: 1500,
  });
  assert.equal(b.fxRate, 1500);
  assert.equal(b.fxRateDate, "2026-01-01");
  assert.equal(b.amountArs, 15000000); // 100.00 EUR * 1500
  assert.equal(b.fxOverridden, true);
});

test("listBookings returns rows newest-first", () => {
  const db = dbWithRates();
  createBooking(db, { guest: "First", date: "2026-06-18", currency: "EUR", amount: 100 });
  createBooking(db, { guest: "Second", date: "2026-06-19", currency: "EUR", amount: 100 });
  const all = listBookings(db);
  assert.equal(all.length, 2);
  assert.equal(all[0].guest, "Second");
});

test("listBookings filters by year", () => {
  const db = dbWithRates();
  upsertFxRate(db, { date: "2025-06-18", compra: 900, venta: 1000 });
  createBooking(db, { guest: "Old", date: "2025-06-18", currency: "EUR", amount: 100 });
  createBooking(db, { guest: "New", date: "2026-06-18", currency: "EUR", amount: 100 });
  const r = listBookings(db, { year: "2026" });
  assert.equal(r.length, 1);
  assert.equal(r[0].guest, "New");
});

test("listBookings filters by guest substring and date range", () => {
  const db = dbWithRates();
  createBooking(db, { guest: "Bob", date: "2026-06-18", currency: "EUR", amount: 100 });
  createBooking(db, { guest: "Alice", date: "2026-06-19", currency: "EUR", amount: 100 });
  assert.equal(listBookings(db, { guest: "ob" })[0].guest, "Bob");
  assert.equal(listBookings(db, { from: "2026-06-19" }).length, 1);
  assert.equal(listBookings(db, { to: "2026-06-18" }).length, 1);
});

test("summarizeBookings groups per-year with grand total", () => {
  const db = dbWithRates();
  upsertFxRate(db, { date: "2025-06-18", compra: 900, venta: 1000 });
  createBooking(db, { guest: "A", date: "2026-06-18", currency: "EUR", amount: 10000 }); // comm 1000
  createBooking(db, { guest: "B", date: "2026-06-19", currency: "EUR", amount: 20000 }); // comm 2000
  createBooking(db, { guest: "C", date: "2025-06-18", currency: "EUR", amount: 10000 });
  const { years, total } = summarizeBookings(listBookings(db));
  assert.equal(years.length, 2);
  assert.equal(years[0].year, "2026"); // sorted newest-first
  const y26 = years.find((y) => y.year === "2026");
  assert.equal(y26?.count, 2);
  assert.equal(y26?.incomeEur, 30000);
  assert.equal(y26?.commissionEur, 3000);
  assert.equal(total.count, 3);
  assert.equal(total.incomeEur, 40000);
});

test("summarizeBookings on empty input", () => {
  assert.deepEqual(summarizeBookings([]), {
    years: [],
    total: { year: "", count: 0, incomeEur: 0, incomeArs: 0, commissionEur: 0 },
  });
});

test("createBooking uses the Settings commission rate by default (BK-7)", () => {
  const db = dbWithRates();
  updateSettings(db, { commissionRate: 0.2 });
  const b = createBooking(db, { guest: "S", date: "2026-06-18", currency: "EUR", amount: 10000 });
  assert.equal(b.commissionRate, 0.2);
  assert.equal(b.commissionEur, 2000);
});

test("cancellations/reimbursements carry zero commission (BK-5)", () => {
  const db = dbWithRates();
  const c = createBooking(db, {
    guest: "X",
    date: "2026-06-18",
    currency: "EUR",
    amount: 10000,
    type: "cancellation",
  });
  assert.equal(c.type, "cancellation");
  assert.equal(c.commissionEur, 0);
});

test("occupancyByMonth groups by month, excludes cancellations, sorts chronologically (BK-6)", () => {
  const rows = [
    { date: "2026-07-10", guest: "B", type: "booking" },
    { date: "2026-06-05", guest: "A", type: "booking" },
    { date: "2026-06-20", guest: "X", type: "cancellation" },
    { date: "2026-06-12", guest: "C", type: "booking" },
  ];
  const r = occupancyByMonth(rows);
  assert.equal(r.length, 2);
  assert.equal(r[0].month, "2026-06");
  assert.deepEqual(
    r[0].bookings.map((b) => b.guest),
    ["A", "C"], // sorted by date within the month
  );
  assert.equal(r[1].month, "2026-07");
  assert.ok(!r.some((m) => m.bookings.some((b) => b.guest === "X"))); // cancellation excluded
});

test("occupancyByMonth sums nights per month from check-out (BK-6)", () => {
  const r = occupancyByMonth([
    { date: "2026-06-05", checkOut: "2026-06-08", guest: "A", type: "booking" }, // 3 nights
    { date: "2026-06-20", checkOut: "2026-06-22", guest: "C", type: "booking" }, // 2 nights
    { date: "2026-06-12", guest: "B", type: "booking" }, // legacy, no check-out → 0
  ]);
  assert.equal(r[0].month, "2026-06");
  assert.equal(r[0].nights, 5);
});

test("createBooking defaults channel to direct", () => {
  const db = dbWithRates();
  const b = createBooking(db, { guest: "D", date: "2026-06-18", currency: "EUR", amount: 100 });
  assert.equal(b.channel, "direct");
});

test("createBooking stores the booking channel (booking.com / airbnb)", () => {
  const db = dbWithRates();
  const a = createBooking(db, {
    guest: "A",
    date: "2026-06-18",
    currency: "EUR",
    amount: 100,
    channel: "airbnb",
  });
  const b = createBooking(db, {
    guest: "B",
    date: "2026-06-18",
    currency: "EUR",
    amount: 100,
    channel: "booking",
  });
  assert.equal(a.channel, "airbnb");
  assert.equal(b.channel, "booking");
});

test("createBooking stores an optional check-out date (CA-83)", () => {
  const db = dbWithRates();
  const b = createBooking(db, {
    guest: "Stay",
    date: "2026-06-18",
    checkOut: "2026-06-21",
    currency: "EUR",
    amount: 100,
  });
  assert.equal(b.checkOut, "2026-06-21");
});

test("createBooking leaves check-out null when omitted (legacy/import rows)", () => {
  const db = dbWithRates();
  const b = createBooking(db, { guest: "NoOut", date: "2026-06-18", currency: "EUR", amount: 100 });
  assert.equal(b.checkOut, null);
});

test("createBooking rejects a check-out on/before check-in", () => {
  const db = dbWithRates();
  assert.throws(() =>
    createBooking(db, {
      guest: "Bad",
      date: "2026-06-18",
      checkOut: "2026-06-18", // same day → zero nights
      currency: "EUR",
      amount: 100,
    }),
  );
});

test("occupancyByMonth carries the check-out for range rendering (CA-83)", () => {
  const r = occupancyByMonth([
    { date: "2026-06-05", guest: "A", type: "booking", channel: "airbnb", checkOut: "2026-06-09" },
  ]);
  assert.equal(r[0].bookings[0].checkOut, "2026-06-09");
});

test("listBookings filters by channel", () => {
  const db = dbWithRates();
  createBooking(db, {
    guest: "Air",
    date: "2026-06-18",
    currency: "EUR",
    amount: 100,
    channel: "airbnb",
  });
  createBooking(db, { guest: "Dir", date: "2026-06-18", currency: "EUR", amount: 100 });
  const r = listBookings(db, { channel: "airbnb" });
  assert.equal(r.length, 1);
  assert.equal(r[0].guest, "Air");
});

test("occupancyByMonth carries the channel for the calendar", () => {
  const r = occupancyByMonth([
    { date: "2026-06-05", guest: "A", type: "booking", channel: "airbnb" },
  ]);
  assert.equal(r[0].bookings[0].channel, "airbnb");
});

test("accruedCommissionEur sums commission across bookings (BK-3)", () => {
  const db = dbWithRates();
  createBooking(db, { guest: "A", date: "2026-06-18", currency: "EUR", amount: 10000 }); // 1000 @0.1
  createBooking(db, { guest: "B", date: "2026-06-18", currency: "EUR", amount: 20000 }); // 2000
  createBooking(db, {
    guest: "C",
    date: "2026-06-18",
    currency: "EUR",
    amount: 10000,
    type: "cancellation",
  }); // 0
  assert.equal(accruedCommissionEur(db), 3000);
});
