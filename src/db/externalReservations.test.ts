import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conflictsFor,
  importIcal,
  listReservations,
  upsertReservations,
} from "./externalReservations.ts";
import { updateSettings } from "./settings.ts";
import { makeTestDb } from "./testdb.ts";

const ev = (uid: string, start: string, end: string) => ({ uid, start, end, summary: "Reserved" });

test("upsertReservations is idempotent on UID (re-fetch updates, never duplicates)", () => {
  const db = makeTestDb();
  upsertReservations(db, "airbnb", [ev("a@x", "2026-07-01", "2026-07-05")]);
  // same UID, moved dates — should replace, not add a second row
  upsertReservations(db, "airbnb", [ev("a@x", "2026-07-02", "2026-07-06")]);
  const rows = listReservations(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].start, "2026-07-02");
});

test("upsertReservations prunes events that vanish from the feed", () => {
  const db = makeTestDb();
  upsertReservations(db, "airbnb", [
    ev("a@x", "2026-07-01", "2026-07-05"),
    ev("b@x", "2026-08-01", "2026-08-03"),
  ]);
  upsertReservations(db, "airbnb", [ev("a@x", "2026-07-01", "2026-07-05")]); // b cancelled on the OTA
  assert.deepEqual(
    listReservations(db).map((r) => r.uid),
    ["a@x"],
  );
});

test("upsertReservations isolates channels", () => {
  const db = makeTestDb();
  upsertReservations(db, "airbnb", [ev("a@x", "2026-07-01", "2026-07-05")]);
  upsertReservations(db, "booking", [ev("b@y", "2026-07-10", "2026-07-12")]);
  upsertReservations(db, "airbnb", []); // clearing airbnb must not touch booking
  assert.deepEqual(
    listReservations(db).map((r) => r.uid),
    ["b@y"],
  );
});

test("conflictsFor finds overlapping blocks, ignores same-day turnover", () => {
  const db = makeTestDb();
  upsertReservations(db, "airbnb", [ev("a@x", "2026-07-01", "2026-07-05")]);
  assert.equal(conflictsFor(db, "2026-07-04", "2026-07-08").length, 1); // overlaps
  assert.equal(conflictsFor(db, "2026-07-05", "2026-07-08").length, 0); // turnover, no conflict
  assert.equal(conflictsFor(db, "2026-07-10", "2026-07-12").length, 0); // disjoint
});

test("conflictsFor honors a configured booking gap", () => {
  const db = makeTestDb();
  upsertReservations(db, "airbnb", [ev("a@x", "2026-07-01", "2026-07-05")]);
  // explicit gap arg: a check-in on the 5th now needs a buffer day → conflict
  assert.equal(conflictsFor(db, "2026-07-05", "2026-07-08", 1).length, 1);
  assert.equal(conflictsFor(db, "2026-07-06", "2026-07-08", 1).length, 0);
  // gap read from Settings
  updateSettings(db, { bookingGapDays: 1 });
  assert.equal(conflictsFor(db, "2026-07-05", "2026-07-08").length, 1);
});

test("importIcal parses a feed and stores it", async () => {
  const db = makeTestDb();
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260701
DTEND;VALUE=DATE:20260705
UID:feed@airbnb.com
SUMMARY:Reserved
END:VEVENT
END:VCALENDAR`;
  const fakeFetch = (async () => new Response(ics, { status: 200 })) as unknown as typeof fetch;
  await importIcal(db, "airbnb", "https://example/ical.ics", fakeFetch);
  assert.deepEqual(
    listReservations(db).map((r) => r.uid),
    ["feed@airbnb.com"],
  );
});
