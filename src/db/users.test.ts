import assert from "node:assert/strict";
import { test } from "node:test";
import { makeTestDb } from "./testdb.ts";
import { createUser, getUserByEmail, setPassword, updateUser } from "./users.ts";

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

test("updateUser changes role and status", () => {
  const db = makeTestDb();
  const u = createUser(db, sample);
  const upd = updateUser(db, u.id, { role: "user", status: "disabled" });
  assert.equal(upd.role, "user");
  assert.equal(upd.status, "disabled");
  assert.equal(getUserByEmail(db, sample.email)?.status, "disabled");
});

test("setPassword replaces only the stored hash", () => {
  const db = makeTestDb();
  const u = createUser(db, sample);
  const upd = setPassword(db, u.id, "newhash");
  assert.equal(upd.passwordHash, "newhash");
  assert.equal(getUserByEmail(db, sample.email)?.passwordHash, "newhash");
  assert.equal(getUserByEmail(db, sample.email)?.name, "Nico"); // nothing else touched
});
