import assert from "node:assert/strict";
import { test } from "node:test";
import { createCategory } from "./expenses.ts";
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
