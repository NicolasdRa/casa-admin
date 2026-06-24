import assert from "node:assert/strict";
import { test } from "node:test";
import {
  can,
  defaultEntryCurrency,
  mayReimburse,
  userDeleteError,
  userEditError,
} from "./permissions.ts";

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

test("userDeleteError: cannot delete yourself (anti-lockout)", () => {
  assert.equal(userDeleteError(1, [{ id: 1, role: "superadmin", status: "active" }], 2), "self");
  // ...even mixed into a bulk selection
  assert.equal(
    userDeleteError(
      1,
      [
        { id: 3, role: "admin", status: "active" },
        { id: 1, role: "superadmin", status: "active" },
      ],
      2,
    ),
    "self",
  );
});

test("userDeleteError: cannot remove the last active superadmin", () => {
  assert.equal(
    userDeleteError(1, [{ id: 2, role: "superadmin", status: "active" }], 1),
    "last_superadmin",
  );
  // bulk that wipes out every active superadmin
  assert.equal(
    userDeleteError(
      1,
      [
        { id: 2, role: "superadmin", status: "active" },
        { id: 4, role: "superadmin", status: "active" },
      ],
      2,
    ),
    "last_superadmin",
  );
  // fine when an active superadmin survives
  assert.equal(userDeleteError(1, [{ id: 2, role: "superadmin", status: "active" }], 2), null);
  // a disabled superadmin doesn't count toward the active total, so deleting it is fine
  assert.equal(userDeleteError(1, [{ id: 2, role: "superadmin", status: "disabled" }], 1), null);
});

test("userDeleteError: ordinary deletes allowed", () => {
  assert.equal(userDeleteError(1, [{ id: 3, role: "admin", status: "active" }], 1), null);
  assert.equal(userDeleteError(1, [{ id: 3, role: "user", status: "disabled" }], 1), null);
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

// The on-the-ground manager (admin) works in pesos, so entry defaults to ARS;
// the owner abroad (superadmin) and the co-host (user) default to EUR. EUR is
// always derivable from the ARS via the immutable FX snapshot, so this only
// sets the *starting* currency, never the stored money.
test("defaultEntryCurrency: admin enters in ARS, everyone else in EUR", () => {
  assert.equal(defaultEntryCurrency("admin"), "ARS");
  assert.equal(defaultEntryCurrency("superadmin"), "EUR");
  assert.equal(defaultEntryCurrency("user"), "EUR");
});

// EX-9: an actor may reimburse a co-host's expense only if they BOTH hold the capability (admin+)
// AND are mapped to a partner (an owner). The capability lived in the RPC gate, the owner check in
// the db fn — mayReimburse unifies the two so the UI, RPC and db can't drift apart.
test("mayReimburse: needs both the capability and an owner (partner) mapping", () => {
  assert.equal(mayReimburse({ role: "admin", partnerId: 7 }), true);
  assert.equal(mayReimburse({ role: "superadmin", partnerId: 1 }), true);
  // capability but not an owner — db would reject with reimburserNotOwner, so the gate must too
  assert.equal(mayReimburse({ role: "admin", partnerId: null }), false);
  // owner mapping but no capability (co-host who happens to be partner-mapped)
  assert.equal(mayReimburse({ role: "user", partnerId: 7 }), false);
  assert.equal(mayReimburse({ role: "user", partnerId: null }), false);
});
