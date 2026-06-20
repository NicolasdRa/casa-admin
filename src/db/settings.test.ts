import assert from "node:assert/strict";
import { test } from "node:test";
import * as schema from "./schema.ts";
import { getSettings, updateSettings } from "./settings.ts";
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
