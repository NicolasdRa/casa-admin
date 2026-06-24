import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCategory,
  createExpense,
  expenseTotalsByUser,
  getExpenseById,
  listExpenses,
  listExpensesWithPayer,
  markExpenseReimbursed,
  receiptPlan,
  reimburseExpenses,
  reimbursementStatus,
  safeExt,
  setExpenseReceipt,
  updateExpenseMeta,
} from "./expenses.ts";
import { upsertFxRate } from "./fx.ts";
import { createPartner } from "./partners.ts";
import { createSupplier } from "./suppliers.ts";
import { makeTestDb } from "./testdb.ts";
import { createUser, getUserById } from "./users.ts";

function dbWithRates() {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1100 }); // avg 1050
  return db;
}

test("createExpense snapshots FX and stores both currencies", () => {
  const db = dbWithRates();
  const e = createExpense(db, {
    date: "2026-06-18",
    currency: "ARS",
    amount: 5250000, // 52 500.00 ARS
    detail: "Gas",
  });
  assert.equal(e.amountArs, 5250000); // entered side preserved
  assert.equal(e.amountEur, 5000); // 52 500.00 / 1050 = 50.00 EUR
  assert.equal(e.fxRate, 1050);
  assert.equal(e.fxRateDate, "2026-06-18");
  assert.equal(e.detail, "Gas");
  assert.ok(e.id > 0);
});

test("receiptPlan normalises images to webp, passes through the rest (EX-6)", () => {
  assert.equal(receiptPlan("image/jpeg"), "webp");
  assert.equal(receiptPlan("image/png"), "webp");
  assert.equal(receiptPlan("image/heic"), "webp");
  assert.equal(receiptPlan("image/svg+xml"), "passthrough"); // vector, not raster
  assert.equal(receiptPlan("application/pdf"), "passthrough");
  assert.equal(receiptPlan(""), "passthrough");
});

test("safeExt extracts a lowercase extension or empty (EX-6)", () => {
  assert.equal(safeExt("scan.PDF"), "pdf");
  assert.equal(safeExt("a.b.jpeg"), "jpeg");
  assert.equal(safeExt("noext"), "");
  assert.equal(safeExt("../../etc/passwd"), ""); // no extension -> empty, no traversal token kept
});

test("setExpenseReceipt attaches a receipt to an expense (EX-6)", () => {
  const db = dbWithRates();
  const e = createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 5000 });
  setExpenseReceipt(db, e.id, "receipt-1.pdf");
  assert.equal(getExpenseById(db, e.id)?.receiptUrl, "receipt-1.pdf");
});

test("createExpense throws when no FX rate exists on/before the date", () => {
  const db = dbWithRates();
  assert.throws(() => createExpense(db, { date: "2020-01-01", currency: "EUR", amount: 100 }));
});

test("listExpenses returns rows newest-first", () => {
  const db = dbWithRates();
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 100, detail: "A" });
  upsertFxRate(db, { date: "2026-06-19", compra: 1180, venta: 1220 });
  createExpense(db, { date: "2026-06-19", currency: "EUR", amount: 100, detail: "B" });
  const all = listExpenses(db);
  assert.equal(all.length, 2);
  assert.equal(all[0].detail, "B");
});

// EX-8: an owner-user (mapped to a partner) and a co-host (no partner).
function dbWithOwnerAndCohost() {
  const db = dbWithRates();
  const nico = createPartner(db, { name: "Nicolás", defaultShare: 0.5 });
  const owner = createUser(db, {
    name: "Nicolás",
    email: "n@x.test",
    passwordHash: "h",
    role: "admin",
    partnerId: nico.id,
  });
  const cohost = createUser(db, {
    name: "Co-host",
    email: "c@x.test",
    passwordHash: "h",
    role: "user",
  });
  const admin = createUser(db, {
    name: "Admin",
    email: "a@x.test",
    passwordHash: "h",
    role: "admin",
    partnerId: nico.id,
  });
  return { db, owner, cohost, admin };
}

test("createExpense records the paying user (EX-8)", () => {
  const { db, owner } = dbWithOwnerAndCohost();
  const e = createExpense(db, {
    date: "2026-06-18",
    currency: "EUR",
    amount: 5000,
    paidByUserId: owner.id,
  });
  assert.equal(getExpenseById(db, e.id)?.paidByUserId, owner.id);
});

test("createExpense without a payer persists null (import/blank path)", () => {
  const db = dbWithRates();
  const e = createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 5000 });
  assert.equal(getExpenseById(db, e.id)?.paidByUserId, null);
});

test("expenseTotalsByUser groups by payer incl. a null bucket (EX-8)", () => {
  const { db, owner, cohost } = dbWithOwnerAndCohost();
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 10000, paidByUserId: owner.id });
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 20000, paidByUserId: owner.id });
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 5000, paidByUserId: cohost.id });
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 700 }); // null payer
  const totals = expenseTotalsByUser(db);
  const by = (id: number | null) => totals.find((t) => t.userId === id)?.totalEur;
  assert.equal(by(owner.id), 30000);
  assert.equal(by(cohost.id), 5000);
  assert.equal(by(null), 700);
});

test("reimbursementStatus: owner-paid is not_applicable, co-host-paid is pending (EX-9)", () => {
  const { db, owner, cohost } = dbWithOwnerAndCohost();
  const byOwner = createExpense(db, {
    date: "2026-06-18",
    currency: "EUR",
    amount: 1000,
    paidByUserId: owner.id,
  });
  const byCohost = createExpense(db, {
    date: "2026-06-18",
    currency: "EUR",
    amount: 1000,
    paidByUserId: cohost.id,
  });
  assert.equal(reimbursementStatus(byOwner, getUserById(db, owner.id)), "not_applicable");
  assert.equal(reimbursementStatus(byCohost, getUserById(db, cohost.id)), "pending");
});

test("markExpenseReimbursed moves a co-host expense pending -> reimbursed (EX-9)", () => {
  const { db, cohost, admin } = dbWithOwnerAndCohost();
  const e = createExpense(db, {
    date: "2026-06-18",
    currency: "EUR",
    amount: 1000,
    paidByUserId: cohost.id,
  });
  const row = markExpenseReimbursed(db, e.id, admin.id, "2026-06-20");
  assert.equal(row.reimbursedAt, "2026-06-20");
  assert.equal(row.reimbursedByUserId, admin.id);
  assert.equal(reimbursementStatus(row, getUserById(db, cohost.id)), "reimbursed");
});

test("markExpenseReimbursed rejects a not_applicable (owner-paid) expense (EX-9)", () => {
  const { db, owner, admin } = dbWithOwnerAndCohost();
  const e = createExpense(db, {
    date: "2026-06-18",
    currency: "EUR",
    amount: 1000,
    paidByUserId: owner.id,
  });
  assert.throws(() => markExpenseReimbursed(db, e.id, admin.id, "2026-06-20"));
});

test("markExpenseReimbursed rejects a reimburser who is not an owner (EX-9)", () => {
  const { db, cohost } = dbWithOwnerAndCohost();
  const e = createExpense(db, {
    date: "2026-06-18",
    currency: "EUR",
    amount: 1000,
    paidByUserId: cohost.id,
  });
  // co-host has no partner mapping -> cannot be the reimburser
  assert.throws(() => markExpenseReimbursed(db, e.id, cohost.id, "2026-06-20"));
});

test("reimburseExpenses bulk-reimburses several pending co-host expenses (CA-117)", () => {
  const { db, cohost, admin } = dbWithOwnerAndCohost();
  const ids = [1, 2, 3].map(
    () =>
      createExpense(db, {
        date: "2026-06-18",
        currency: "EUR",
        amount: 1000,
        paidByUserId: cohost.id,
      }).id,
  );
  reimburseExpenses(db, ids, admin.id, "2026-06-20");
  for (const id of ids) {
    const row = getExpenseById(db, id);
    assert.equal(row?.reimbursedAt, "2026-06-20");
    assert.equal(row?.reimbursedByUserId, admin.id);
  }
});

test("reimburseExpenses is all-or-nothing: one bad id rolls back the whole batch (CA-117)", () => {
  const { db, owner, cohost, admin } = dbWithOwnerAndCohost();
  const good = createExpense(db, {
    date: "2026-06-18",
    currency: "EUR",
    amount: 1000,
    paidByUserId: cohost.id,
  }).id;
  // owner-paid -> not_applicable, so markExpenseReimbursed throws; the good row must NOT persist.
  const bad = createExpense(db, {
    date: "2026-06-18",
    currency: "EUR",
    amount: 1000,
    paidByUserId: owner.id,
  }).id;
  assert.throws(() => reimburseExpenses(db, [good, bad], admin.id, "2026-06-20"));
  assert.equal(getExpenseById(db, good)?.reimbursedAt, null);
});

test("updateExpenseMeta edits classification and leaves the money/FX snapshot intact", () => {
  const db = dbWithRates();
  const gas = createSupplier(db, "Gas Co");
  const cat = createCategory(db, { name: "Utilities", group: "services" });
  const e = createExpense(db, {
    date: "2026-06-18",
    currency: "ARS",
    amount: 5250000,
    detail: "old",
  });
  updateExpenseMeta(db, e.id, { detail: "new", categoryId: cat.id, supplierId: gas.id });
  const updated = getExpenseById(db, e.id);
  assert.equal(updated?.detail, "new");
  assert.equal(updated?.categoryId, cat.id);
  assert.equal(updated?.supplierId, gas.id);
  // immutable snapshot untouched by a metadata edit
  assert.equal(updated?.amountArs, 5250000);
  assert.equal(updated?.amountEur, 5000);
  assert.equal(updated?.fxRate, 1050);
  // each field clears back to null
  updateExpenseMeta(db, e.id, { detail: null, categoryId: null, supplierId: null });
  const cleared = getExpenseById(db, e.id);
  assert.equal(cleared?.detail, null);
  assert.equal(cleared?.categoryId, null);
  assert.equal(cleared?.supplierId, null);
});

test("updateExpenseMeta can (re)assign or clear the payer (fixes unattributed rows)", () => {
  const { db, owner } = dbWithOwnerAndCohost();
  const e = createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 5000 }); // null payer
  assert.equal(getExpenseById(db, e.id)?.paidByUserId, null);
  updateExpenseMeta(db, e.id, {
    detail: null,
    categoryId: null,
    supplierId: null,
    paidByUserId: owner.id,
  });
  assert.equal(getExpenseById(db, e.id)?.paidByUserId, owner.id);
  // and back to unattributed
  updateExpenseMeta(db, e.id, {
    detail: null,
    categoryId: null,
    supplierId: null,
    paidByUserId: null,
  });
  assert.equal(getExpenseById(db, e.id)?.paidByUserId, null);
});

test("updateExpenseMeta leaves the payer untouched when paidByUserId is omitted", () => {
  const { db, owner } = dbWithOwnerAndCohost();
  const e = createExpense(db, {
    date: "2026-06-18",
    currency: "EUR",
    amount: 5000,
    paidByUserId: owner.id,
  });
  updateExpenseMeta(db, e.id, { detail: "edited", categoryId: null, supplierId: null });
  const row = getExpenseById(db, e.id);
  assert.equal(row?.detail, "edited");
  assert.equal(row?.paidByUserId, owner.id); // not wiped by a classification-only edit
});

test("listExpensesWithPayer carries the raw supplierId for the inline picker", () => {
  const db = dbWithRates();
  const gas = createSupplier(db, "Gas Co");
  createExpense(db, {
    date: "2026-06-18",
    currency: "EUR",
    amount: 5000,
    supplierId: gas.id,
    detail: "with supplier",
  });
  createExpense(db, { date: "2026-06-18", currency: "EUR", amount: 5000, detail: "no supplier" });
  const rows = listExpensesWithPayer(db);
  assert.equal(rows.find((r) => r.detail === "with supplier")?.supplierId, gas.id);
  assert.equal(rows.find((r) => r.detail === "no supplier")?.supplierId, null);
});
