import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupplier, listSuppliers } from "./suppliers.ts";
import { makeTestDb } from "./testdb.ts";

test("createSupplier trims and stores a supplier", () => {
  const db = makeTestDb();
  const s = createSupplier(db, "  Ferretería López  ");
  assert.equal(s.name, "Ferretería López");
  assert.ok(s.id > 0);
});

test("createSupplier rejects an empty name", () => {
  const db = makeTestDb();
  assert.throws(() => createSupplier(db, "   "));
});

test("createSupplier is idempotent by name (case-insensitive) — no duplicates", () => {
  const db = makeTestDb();
  const a = createSupplier(db, "Edesur");
  const b = createSupplier(db, "edesur");
  assert.equal(a.id, b.id);
  assert.equal(listSuppliers(db).length, 1);
});

test("listSuppliers returns rows sorted by name", () => {
  const db = makeTestDb();
  createSupplier(db, "Zeta");
  createSupplier(db, "Alfa");
  assert.deepEqual(
    listSuppliers(db).map((s) => s.name),
    ["Alfa", "Zeta"],
  );
});
