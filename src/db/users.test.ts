import assert from "node:assert/strict";
import { test } from "node:test";
import { makeTestDb } from "./testdb.ts";
import { createUser, getUserByEmail } from "./users.ts";

const sample = {
  name: "Nico",
  email: "Nico@Example.com",
  passwordHash: "h",
  role: "admin" as const,
};

test("createUser stores the user with a lowercased email", () => {
  const db = makeTestDb();
  const u = createUser(db, sample);
  assert.equal(u.email, "nico@example.com");
  assert.equal(u.role, "admin");
  assert.equal(u.locale, "es"); // default
  assert.ok(u.id > 0);
});

test("getUserByEmail is case-insensitive; null when absent", () => {
  const db = makeTestDb();
  createUser(db, sample);
  assert.equal(getUserByEmail(db, "NICO@example.com")?.name, "Nico");
  assert.equal(getUserByEmail(db, "missing@example.com"), null);
});

test("duplicate email is rejected", () => {
  const db = makeTestDb();
  createUser(db, sample);
  assert.throws(() => createUser(db, { ...sample, name: "Dup" }));
});
