import assert from "node:assert/strict";
import { test } from "node:test";
import { CodedError } from "../lib/errors.ts";
import * as schema from "./schema.ts";
import { makeTestDb } from "./testdb.ts";
import {
  createUser,
  deleteUser,
  deleteUsers,
  getUserByEmail,
  getUserById,
  setPassword,
  updateUser,
} from "./users.ts";

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

test("deleteUser removes an account with no history", () => {
  const db = makeTestDb();
  const u = createUser(db, sample);
  deleteUser(db, u.id);
  assert.equal(getUserById(db, u.id), null);
});

test("deleteUser refuses an account referenced by the audit log (disable instead)", () => {
  const db = makeTestDb();
  const u = createUser(db, sample);
  db.insert(schema.auditLog).values({ userId: u.id, action: "create", entity: "expense" }).run();
  assert.throws(
    () => deleteUser(db, u.id),
    (e) => e instanceof CodedError && e.code === "inUse",
  );
  assert.ok(getUserById(db, u.id)); // still there
});

test("deleteUser refuses an account that paid an expense", () => {
  const db = makeTestDb();
  const u = createUser(db, sample);
  db.insert(schema.expenses)
    .values({
      date: "2026-01-01",
      currency: "EUR",
      amount: 100,
      fxRate: 1,
      fxRateDate: "2026-01-01",
      amountEur: 100,
      amountArs: 100,
      paidByUserId: u.id,
    })
    .run();
  assert.throws(
    () => deleteUser(db, u.id),
    (e) => e instanceof CodedError && e.code === "inUse",
  );
});

test("deleteUsers is all-or-nothing: one referenced id rolls back the batch", () => {
  const db = makeTestDb();
  const keep = createUser(db, sample);
  const drop = createUser(db, { ...sample, email: "drop@example.com" });
  db.insert(schema.auditLog).values({ userId: keep.id, action: "x", entity: "y" }).run();
  assert.throws(
    () => deleteUsers(db, [drop.id, keep.id]),
    (e) => e instanceof CodedError && e.code === "inUse",
  );
  assert.ok(getUserById(db, drop.id)); // rolled back — not deleted despite being clean
});
