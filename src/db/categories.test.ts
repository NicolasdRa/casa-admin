import assert from "node:assert/strict";
import { test } from "node:test";
import { createCategory, deleteCategory, listCategories, renameCategory } from "./expenses.ts";
import * as schema from "./schema.ts";
import { makeTestDb } from "./testdb.ts";

test("createCategory stores a trimmed name with a valid group", () => {
  const db = makeTestDb();
  const c = createCategory(db, { name: "  Limpieza  ", group: "services" });
  assert.equal(c.name, "Limpieza");
  assert.equal(c.group, "services");
  assert.ok(c.id > 0);
});

test("createCategory rejects empty name and invalid group", () => {
  const db = makeTestDb();
  assert.throws(() => createCategory(db, { name: " ", group: "services" }));
  assert.throws(() => createCategory(db, { name: "X", group: "bogus" as never }));
});

test("renameCategory trims and updates the name", () => {
  const db = makeTestDb();
  const c = createCategory(db, { name: "Limpeza", group: "services" });
  const r = renameCategory(db, c.id, "  Limpieza  ");
  assert.equal(r.name, "Limpieza");
  assert.equal(listCategories(db)[0].name, "Limpieza");
});

test("renameCategory rejects an empty name", () => {
  const db = makeTestDb();
  const c = createCategory(db, { name: "Servicios", group: "services" });
  assert.throws(() => renameCategory(db, c.id, "   "));
});

test("deleteCategory removes an unreferenced category", () => {
  const db = makeTestDb();
  const c = createCategory(db, { name: "Temp", group: "operating" });
  deleteCategory(db, c.id);
  assert.equal(listCategories(db).length, 0);
});

test("deleteCategory refuses to delete a category referenced by an expense", () => {
  const db = makeTestDb();
  const c = createCategory(db, { name: "Servicios", group: "services" });
  // minimal expense row referencing the category
  db.insert(schema.expenses)
    .values({
      date: "2026-01-01",
      detail: "luz",
      categoryId: c.id,
      currency: "ARS",
      amount: 1000,
      fxRate: 1,
      fxRateDate: "2026-01-01",
      amountEur: 1,
      amountArs: 1000,
    })
    .run();
  assert.throws(() => deleteCategory(db, c.id), /in use|referenced|expense/i);
});
