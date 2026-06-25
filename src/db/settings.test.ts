import assert from "node:assert/strict";
import { test } from "node:test";
import * as schema from "./schema.ts";
import { getSettings, parseSettings, updateSettings } from "./settings.ts";
import { makeTestDb } from "./testdb.ts";

test("getSettings returns a singleton with defaults (commission 10%)", () => {
  const db = makeTestDb();
  const s = getSettings(db);
  assert.equal(s.commissionRate, 0.1);
  assert.equal(s.fxSource, "BNA");
  assert.equal(s.defaultLocale, "es");
  getSettings(db); // idempotent — must not create a second row
  assert.equal(db.select().from(schema.settings).all().length, 1);
});

test("updateSettings persists changes", () => {
  const db = makeTestDb();
  const s = updateSettings(db, { commissionRate: 0.15 });
  assert.equal(s.commissionRate, 0.15);
  assert.equal(getSettings(db).commissionRate, 0.15);
});

test("parseSettings converts a valid commission percent to a rate", () => {
  const f = new FormData();
  f.set("commissionPct", "12.5");
  const r = parseSettings(f);
  assert.ok("patch" in r);
  assert.equal(r.patch.commissionRate, 0.125);
});

test("parseSettings rejects an out-of-range commission instead of silently dropping it", () => {
  for (const bad of ["150", "-1", "abc"]) {
    const f = new FormData();
    f.set("commissionPct", bad);
    assert.deepEqual(parseSettings(f), { error: "commissionInvalid" }, `expected ${bad} rejected`);
  }
});

test("parseSettings skips a blank commission (leaves the stored value untouched)", () => {
  const f = new FormData();
  f.set("commissionPct", "");
  const r = parseSettings(f);
  assert.ok("patch" in r);
  assert.equal("commissionRate" in r.patch, false);
});

test("parseSettings collects locale, trimmed fxSource and backupCadence", () => {
  const f = new FormData();
  f.set("defaultLocale", "en");
  f.set("fxSource", " BNA ");
  f.set("backupCadence", "daily");
  const r = parseSettings(f);
  assert.ok("patch" in r);
  assert.deepEqual(r.patch, { defaultLocale: "en", fxSource: "BNA", backupCadence: "daily" });
});

test("parseSettings ignores an unsupported fxSource or backupCadence (no garbage persisted)", () => {
  const f = new FormData();
  f.set("fxSource", "Bloomberg");
  f.set("backupCadence", "hourly");
  const r = parseSettings(f);
  assert.ok("patch" in r);
  assert.equal("fxSource" in r.patch, false);
  assert.equal("backupCadence" in r.patch, false);
});

test("parseSettings accepts each supported backup cadence", () => {
  for (const c of ["daily", "weekly", "monthly", "off"]) {
    const f = new FormData();
    f.set("backupCadence", c);
    const r = parseSettings(f);
    assert.ok("patch" in r, `expected patch for ${c}`);
    assert.equal(r.patch.backupCadence, c);
  }
});

test("parseSettings accepts a valid iCal URL and clears it when blank", () => {
  const ok = new FormData();
  ok.set("airbnbIcalUrl", "https://www.airbnb.com/calendar/ical/123.ics?s=abc");
  const r = parseSettings(ok);
  assert.deepEqual(r, {
    patch: { airbnbIcalUrl: "https://www.airbnb.com/calendar/ical/123.ics?s=abc" },
  });

  const blank = new FormData();
  blank.set("airbnbIcalUrl", "  ");
  assert.deepEqual(parseSettings(blank), { patch: { airbnbIcalUrl: null } });
});

test("parseSettings rejects a non-http iCal URL", () => {
  const bad = new FormData();
  bad.set("bookingIcalUrl", "ftp://nope");
  assert.deepEqual(parseSettings(bad), { error: "icalUrlInvalid" });
});

test("parseSettings accepts a non-negative integer booking gap and rejects junk", () => {
  const ok = new FormData();
  ok.set("bookingGapDays", "2");
  assert.deepEqual(parseSettings(ok), { patch: { bookingGapDays: 2 } });

  const neg = new FormData();
  neg.set("bookingGapDays", "-1");
  assert.deepEqual(parseSettings(neg), { error: "gapInvalid" });

  const frac = new FormData();
  frac.set("bookingGapDays", "1.5");
  assert.deepEqual(parseSettings(frac), { error: "gapInvalid" });
});
