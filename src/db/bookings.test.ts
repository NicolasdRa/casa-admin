import assert from "node:assert/strict";
import { test } from "node:test";
import { CodedError } from "../lib/errors.ts";
import {
  accruedCommissionEur,
  createBooking,
  deleteBooking,
  deleteBookings,
  editBookingDetails,
  findConflicts,
  listBookings,
  mergeOccupancy,
  occupancyByMonth,
  occupancyPct,
  summarizeBookings,
} from "./bookings.ts";
import { bookingPayments, deleteCashEntry, registerBookingPayment } from "./cash.ts";
import { upsertReservations } from "./externalReservations.ts";
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

test("listBookings filters by co-host", () => {
  const db = dbWithRates();
  createBooking(db, {
    guest: "F",
    date: "2026-06-18",
    currency: "EUR",
    amount: 100,
    coHostUserId: 5,
  });
  createBooking(db, {
    guest: "G",
    date: "2026-06-18",
    currency: "EUR",
    amount: 100,
    coHostUserId: 6,
  });
  const r = listBookings(db, { coHostUserId: 5 });
  assert.equal(r.length, 1);
  assert.equal(r[0].guest, "F");
});

test("occupancyPct uses the calendar month's night count (days-in-month, leap-aware)", () => {
  assert.equal(occupancyPct("2026-06", 15), 50); // June has 30 nights
  assert.equal(occupancyPct("2026-07", 31), 100); // July has 31 nights → fully booked
  assert.equal(occupancyPct("2024-02", 29), 100); // leap Feb has 29 nights
  assert.equal(occupancyPct("2026-02", 29), 104); // non-leap Feb has 28 → boundary stay >100%
});

test("occupancyPct is zero with no nights", () => {
  assert.equal(occupancyPct("2026-06", 0), 0);
});

test("listBookings date range filters check-in inclusively (occupancy date range)", () => {
  const db = dbWithRates();
  const r1 = 1000; // manualRate so boundary dates need no seeded BNA quote
  createBooking(db, {
    guest: "May",
    date: "2026-05-31",
    currency: "EUR",
    amount: 100,
    manualRate: r1,
  });
  createBooking(db, {
    guest: "JunIn",
    date: "2026-06-01",
    currency: "EUR",
    amount: 100,
    manualRate: r1,
  });
  createBooking(db, {
    guest: "JunOut",
    date: "2026-06-30",
    currency: "EUR",
    amount: 100,
    manualRate: r1,
  });
  createBooking(db, {
    guest: "Jul",
    date: "2026-07-01",
    currency: "EUR",
    amount: 100,
    manualRate: r1,
  });
  const r = occupancyByMonth(listBookings(db, { from: "2026-06-01", to: "2026-06-30" }));
  assert.equal(r.length, 1);
  assert.equal(r[0].month, "2026-06");
  assert.deepEqual(
    r[0].bookings.map((b) => b.guest).sort(),
    ["JunIn", "JunOut"], // boundary dates included; May/Jul excluded
  );
});

test("occupancyByMonth carries the channel for the calendar", () => {
  const r = occupancyByMonth([
    { date: "2026-06-05", guest: "A", type: "booking", channel: "airbnb" },
  ]);
  assert.equal(r[0].bookings[0].channel, "airbnb");
});

test("deleteBooking removes the row", () => {
  const db = dbWithRates();
  const b = createBooking(db, { guest: "Gone", date: "2026-06-18", currency: "EUR", amount: 100 });
  deleteBooking(db, b.id);
  assert.equal(listBookings(db).length, 0);
});

test("deleteBooking refuses a booking that has a cash receipt (delete the receipt first)", () => {
  const db = dbWithRates();
  const b = createBooking(db, {
    guest: "Paid",
    date: "2026-06-18",
    currency: "EUR",
    amount: 10000,
  });
  registerBookingPayment(db, { bookingId: b.id, partnerId: 1, date: "2026-06-20" });
  assert.throws(
    () => deleteBooking(db, b.id),
    (e) => e instanceof CodedError && e.code === "hasPayment",
  );
  assert.equal(listBookings(db).length, 1); // untouched — the receipt is still its source of truth

  deleteCashEntry(db, bookingPayments(db)[0].id); // remove the receipt…
  deleteBooking(db, b.id); // …now it deletes
  assert.equal(listBookings(db).length, 0);
});

test("deleteBookings removes every listed row, all-or-nothing", () => {
  const db = dbWithRates();
  const a = createBooking(db, { guest: "A", date: "2026-06-18", currency: "EUR", amount: 100 });
  const b = createBooking(db, { guest: "B", date: "2026-06-19", currency: "EUR", amount: 100 });
  createBooking(db, { guest: "C", date: "2026-06-19", currency: "EUR", amount: 100 });
  deleteBookings(db, [a.id, b.id]);
  const left = listBookings(db);
  assert.equal(left.length, 1);
  assert.equal(left[0].guest, "C");
});

test("editBookingDetails updates guest/channel/checkOut, leaving the FX snapshot untouched", () => {
  const db = dbWithRates();
  const b = createBooking(db, {
    guest: "Typo",
    date: "2026-06-18",
    currency: "EUR",
    amount: 10000,
    channel: "direct",
  });
  const edited = editBookingDetails(db, b.id, {
    guest: "Fixed",
    channel: "airbnb",
    checkOut: "2026-06-21",
  });
  assert.equal(edited.guest, "Fixed");
  assert.equal(edited.channel, "airbnb");
  assert.equal(edited.checkOut, "2026-06-21");
  // The immutable snapshot is preserved exactly.
  assert.equal(edited.amount, b.amount);
  assert.equal(edited.currency, b.currency);
  assert.equal(edited.fxRate, b.fxRate);
  assert.equal(edited.amountEur, b.amountEur);
  assert.equal(edited.amountArs, b.amountArs);
  assert.equal(edited.commissionEur, b.commissionEur);
});

test("editBookingDetails rejects a check-out on/before check-in", () => {
  const db = dbWithRates();
  const b = createBooking(db, { guest: "X", date: "2026-06-18", currency: "EUR", amount: 100 });
  assert.throws(() => editBookingDetails(db, b.id, { guest: "X", checkOut: "2026-06-18" }));
});

test("editBookingDetails moves the check-in date but keeps the FX snapshot frozen", () => {
  const db = dbWithRates();
  const b = createBooking(db, { guest: "X", date: "2026-06-18", currency: "EUR", amount: 10000 });
  const edited = editBookingDetails(db, b.id, { guest: "X", date: "2026-06-19" });
  assert.equal(edited.date, "2026-06-19"); // calendar date corrected
  // …but the rate snapshotted at entry is untouched — not re-fetched for the new date (1200).
  assert.equal(edited.fxRate, b.fxRate); // still 1050
  assert.equal(edited.fxRateDate, b.fxRateDate); // still 2026-06-18
  assert.equal(edited.amountArs, b.amountArs);
  assert.equal(edited.amountEur, b.amountEur);
});

test("editBookingDetails validates check-out against the NEW check-in date", () => {
  const db = dbWithRates();
  const b = createBooking(db, {
    guest: "X",
    date: "2026-06-18",
    checkOut: "2026-06-19",
    currency: "EUR",
    amount: 100,
  });
  // check-out 06-19 was valid against check-in 06-18; moving check-in to 06-19 makes it invalid.
  assert.throws(() =>
    editBookingDetails(db, b.id, { guest: "X", date: "2026-06-19", checkOut: "2026-06-19" }),
  );
});

test("editBookingDetails rejects an empty guest", () => {
  const db = dbWithRates();
  const b = createBooking(db, { guest: "Y", date: "2026-06-18", currency: "EUR", amount: 100 });
  assert.throws(() => editBookingDetails(db, b.id, { guest: "  " }));
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

test("mergeOccupancy attaches OTA blocks to their start month without inflating nights", () => {
  const months = occupancyByMonth([
    {
      date: "2026-07-02",
      checkOut: "2026-07-06",
      guest: "Smith",
      type: "booking",
      channel: "direct",
    },
  ]);
  const merged = mergeOccupancy(months, [
    { start: "2026-07-10", end: "2026-07-14", channel: "airbnb", summary: "Reserved" },
    { start: "2026-08-01", end: "2026-08-03", channel: "booking", summary: null },
  ]);
  const jul = merged.find((m) => m.month === "2026-07");
  assert.equal(jul?.nights, 4); // unchanged by the block
  assert.equal(jul?.blocks.length, 1);
  assert.equal(jul?.blocks[0].channel, "airbnb");
  // a block in a month with no direct booking still creates a month entry
  assert.ok(merged.find((m) => m.month === "2026-08"));
  // months sort newest-first
  assert.deepEqual(
    merged.map((m) => m.month),
    ["2026-08", "2026-07"],
  );
});

test("mergeOccupancy sorts bookings and blocks newest-first within a month", () => {
  const months = occupancyByMonth([
    {
      date: "2026-07-02",
      checkOut: "2026-07-04",
      guest: "Early",
      type: "booking",
      channel: "direct",
    },
    {
      date: "2026-07-20",
      checkOut: "2026-07-22",
      guest: "Late",
      type: "booking",
      channel: "direct",
    },
  ]);
  const [jul] = mergeOccupancy(months, [
    { start: "2026-07-05", end: "2026-07-08", channel: "airbnb", summary: "A" },
    { start: "2026-07-25", end: "2026-07-28", channel: "booking", summary: "B" },
  ]);
  assert.deepEqual(
    jul.bookings.map((b) => b.guest),
    ["Late", "Early"],
  );
  assert.deepEqual(
    jul.blocks.map((b) => b.start),
    ["2026-07-25", "2026-07-05"],
  );
});

test("findConflicts flags overlapping bookings and OTA blocks, ignores turnover", () => {
  const db = dbWithRates();
  createBooking(db, {
    guest: "Smith",
    date: "2026-07-01",
    checkOut: "2026-07-05",
    currency: "EUR",
    amount: 10000,
  });
  upsertReservations(db, "airbnb", [
    { uid: "x@a", start: "2026-07-20", end: "2026-07-25", summary: "Reserved" },
  ]);

  // overlaps the Smith booking
  const c1 = findConflicts(db, "2026-07-04", "2026-07-08");
  assert.equal(c1.length, 1);
  assert.equal(c1[0].source, "booking");
  assert.equal(c1[0].label, "Smith");

  // overlaps the Airbnb block
  const c2 = findConflicts(db, "2026-07-22", "2026-07-28");
  assert.equal(c2.length, 1);
  assert.equal(c2[0].source, "ota");

  // same-day turnover with the booking → no conflict
  assert.equal(findConflicts(db, "2026-07-05", "2026-07-10").length, 0);
});

test("findConflicts excludes a booking from matching itself (edit case)", () => {
  const db = dbWithRates();
  const b = createBooking(db, {
    guest: "Smith",
    date: "2026-07-01",
    checkOut: "2026-07-05",
    currency: "EUR",
    amount: 10000,
  });
  assert.equal(findConflicts(db, "2026-07-01", "2026-07-05", { excludeBookingId: b.id }).length, 0);
});
