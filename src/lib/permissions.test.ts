import assert from "node:assert/strict";
import { test } from "node:test";
import { can, userEditError } from "./permissions.ts";

const su = { id: 1, role: "superadmin" as const };
const su2 = { id: 2, role: "superadmin" as const };
const admin = { id: 3, role: "admin" as const };

test("userEditError: cannot edit your own role/status (anti-lockout)", () => {
  assert.equal(userEditError(su, su, { role: "admin", status: "active" }, 2), "self");
});

test("userEditError: cannot demote/disable the last active superadmin", () => {
  assert.equal(userEditError(su, su2, { role: "admin", status: "active" }, 1), "last_superadmin");
  assert.equal(
    userEditError(su, su2, { role: "superadmin", status: "disabled" }, 1),
    "last_superadmin",
  );
  // fine when another superadmin remains
  assert.equal(userEditError(su, su2, { role: "admin", status: "active" }, 2), null);
});

test("userEditError: ordinary edits allowed", () => {
  assert.equal(userEditError(su, admin, { role: "user", status: "disabled" }, 2), null);
});

test("superadmin-only capabilities", () => {
  assert.equal(can("superadmin", "manageUsers"), true);
  assert.equal(can("admin", "manageUsers"), false);
  assert.equal(can("user", "manageUsers"), false);
});

test("admin+ capabilities exclude the co-host (user)", () => {
  for (const cap of [
    "deleteBookings",
    "reimburseExpenses",
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
