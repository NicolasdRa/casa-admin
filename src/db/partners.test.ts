import assert from "node:assert/strict";
import { test } from "node:test";
import { createPartner, listPartners } from "./partners.ts";
import { makeTestDb } from "./testdb.ts";

test("createPartner stores name and default share", () => {
  const db = makeTestDb();
  const p = createPartner(db, { name: "Nicolás", defaultShare: 0.5 });
  assert.equal(p.name, "Nicolás");
  assert.equal(p.defaultShare, 0.5);
  assert.ok(p.id > 0);
});

test("default share defaults to 0.5", () => {
  const db = makeTestDb();
  assert.equal(createPartner(db, { name: "Solo" }).defaultShare, 0.5);
});

test("listPartners returns all", () => {
  const db = makeTestDb();
  createPartner(db, { name: "A" });
  createPartner(db, { name: "B" });
  assert.equal(listPartners(db).length, 2);
});
