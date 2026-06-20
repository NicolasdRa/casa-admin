import assert from "node:assert/strict";
import { test } from "node:test";
import { getFxRate, upsertFxRate } from "./fx.ts";
import * as schema from "./schema.ts";
import { makeTestDb as testDb } from "./testdb.ts";

test("upsertFxRate stores the derived average (compra+venta)/2", () => {
  const db = testDb();
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1100 });
  assert.deepEqual(getFxRate(db, "2026-06-18"), {
    date: "2026-06-18",
    compra: 1000,
    venta: 1100,
    average: 1050,
    source: "BNA",
  });
});

test("getFxRate falls back to the latest quote on/before the date", () => {
  const db = testDb();
  upsertFxRate(db, { date: "2026-06-15", compra: 990, venta: 1010 });
  upsertFxRate(db, { date: "2026-06-19", compra: 1050, venta: 1100 }); // Friday
  assert.equal(getFxRate(db, "2026-06-21")?.date, "2026-06-19"); // Sunday -> Friday
});

test("getFxRate returns null when no quote exists on/before the date", () => {
  const db = testDb();
  upsertFxRate(db, { date: "2026-06-19", compra: 1050, venta: 1100 });
  assert.equal(getFxRate(db, "2026-06-01"), null);
});

test("upsertFxRate replaces an existing date — no duplicates", () => {
  const db = testDb();
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1000 });
  upsertFxRate(db, { date: "2026-06-18", compra: 1200, venta: 1300 });
  assert.equal(getFxRate(db, "2026-06-18")?.average, 1250);
  assert.equal(db.select().from(schema.fxRates).all().length, 1);
});

test("upsertFxRate rejects non-positive quotes", () => {
  const db = testDb();
  assert.throws(() => upsertFxRate(db, { date: "2026-06-18", compra: 0, venta: 1100 }));
  assert.throws(() => upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: -5 }));
});
