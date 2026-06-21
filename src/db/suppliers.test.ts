import assert from "node:assert/strict";
import { test } from "node:test";
import * as schema from "./schema.ts";
import { createSupplier, deleteSupplier, listSuppliers, renameSupplier } from "./suppliers.ts";
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

test("renameSupplier trims and updates the name", () => {
  const db = makeTestDb();
  const s = createSupplier(db, "Edesur");
  const updated = renameSupplier(db, s.id, "  Edenor  ");
  assert.equal(updated.name, "Edenor");
  assert.equal(updated.id, s.id);
});

test("renameSupplier rejects an empty name", () => {
  const db = makeTestDb();
  const s = createSupplier(db, "Edesur");
  assert.throws(() => renameSupplier(db, s.id, "   "));
});

test("renameSupplier rejects a name colliding with another supplier (case-insensitive)", () => {
  const db = makeTestDb();
  createSupplier(db, "Edesur");
  const b = createSupplier(db, "Edenor");
  assert.throws(() => renameSupplier(db, b.id, "edesur"));
  // the no-op rename to its own current name (different case) is allowed
  assert.equal(renameSupplier(db, b.id, "EDENOR").name, "EDENOR");
});

test("deleteSupplier removes an unreferenced supplier", () => {
  const db = makeTestDb();
  const s = createSupplier(db, "Edesur");
  deleteSupplier(db, s.id);
  assert.equal(listSuppliers(db).length, 0);
});

test("deleteSupplier refuses to delete a supplier referenced by an expense", () => {
  const db = makeTestDb();
  const s = createSupplier(db, "Edesur");
  // minimal expense row referencing the supplier
  db.insert(schema.expenses)
    .values({
      date: "2026-01-01",
      detail: "luz",
      supplierId: s.id,
      currency: "ARS",
      amount: 1000,
      fxRate: 1,
      fxRateDate: "2026-01-01",
      amountEur: 1,
      amountArs: 1000,
    })
    .run();
  assert.throws(() => deleteSupplier(db, s.id), /in use|referenced|expense/i);
  assert.equal(listSuppliers(db).length, 1);
});
