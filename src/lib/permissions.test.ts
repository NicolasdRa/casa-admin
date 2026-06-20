import assert from "node:assert/strict";
import { test } from "node:test";
import { can } from "./permissions.ts";

test("superadmin-only capabilities", () => {
  assert.equal(can("superadmin", "manageUsers"), true);
  assert.equal(can("admin", "manageUsers"), false);
  assert.equal(can("user", "manageUsers"), false);
});

test("admin+ capabilities exclude the co-host (user)", () => {
  for (const cap of [
    "deleteBookings",
    "viewNetResults",
    "viewPartnerStatements",
    "viewAuditLog",
  ] as const) {
    assert.equal(can("admin", cap), true, `admin ${cap}`);
    assert.equal(can("superadmin", cap), true, `superadmin ${cap}`);
    assert.equal(can("user", cap), false, `user must NOT ${cap}`);
  }
});

test("everyone can do day-to-day entry", () => {
  for (const role of ["superadmin", "admin", "user"] as const) {
    assert.equal(can(role, "createBookings"), true);
    assert.equal(can(role, "createExpenses"), true);
    assert.equal(can(role, "maintenanceTasks"), true);
    assert.equal(can(role, "viewOwnCommission"), true);
  }
});

test("co-host cannot delete or manage cash/config", () => {
  for (const cap of ["deleteExpenses", "managePartnersCash", "manageSettings"] as const) {
    assert.equal(can("user", cap), false);
  }
});
