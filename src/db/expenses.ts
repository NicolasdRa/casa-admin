import { count, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { assertCurrency, assertIsoDate, assertPositiveCents } from "../lib/validate.ts";
import { manualSnapshot, snapshotForDate } from "./fx.ts";
import * as schema from "./schema.ts";
import { getUserById, listUsers } from "./users.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewExpense {
  date: string; // ISO "YYYY-MM-DD"
  currency: "ARS" | "EUR";
  amount: number; // cents in `currency`
  detail?: string;
  categoryId?: number;
  supplierId?: number;
  receiptUrl?: string; // EX-6: stored receipt filename, served via /api/receipt
  manualRate?: number; // FX-7: override the BNA rate (flagged)
  paidByUserId?: number; // EX-8: who fronted it in full; omit for unattributed (import/blank)
}

/** Lowercased file extension restricted to [a-z0-9] (max 5). "" if none — guards against odd names. */
export function safeExt(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(filename);
  return m ? m[1].toLowerCase() : "";
}

/** EX-6: raster images are normalised to webp (downscaled); everything else (PDFs, etc.) stored as-is. */
export function receiptPlan(mimeType: string): "webp" | "passthrough" {
  return mimeType.startsWith("image/") && mimeType !== "image/svg+xml" ? "webp" : "passthrough";
}

/** Record an expense, snapshotting the FX rate + both currencies immutably onto the row. */
export function createExpense(db: Db, input: NewExpense) {
  assertIsoDate(input.date);
  assertCurrency(input.currency);
  assertPositiveCents(input.amount);
  const fx =
    input.manualRate != null
      ? manualSnapshot(input.date, input.currency, input.amount, input.manualRate)
      : snapshotForDate(db, input.date, input.currency, input.amount);
  const [row] = db
    .insert(schema.expenses)
    .values({
      date: input.date,
      currency: input.currency,
      amount: input.amount,
      detail: input.detail ?? null,
      categoryId: input.categoryId ?? null,
      supplierId: input.supplierId ?? null,
      receiptUrl: input.receiptUrl ?? null,
      paidByUserId: input.paidByUserId ?? null,
      fxRate: fx.fxRate,
      fxRateDate: fx.fxRateDate,
      fxOverridden: input.manualRate != null,
      amountEur: fx.amountEur,
      amountArs: fx.amountArs,
    })
    .returning()
    .all();
  // EX-8/EX-11: the expense is fronted in full by `paidByUserId`. No per-expense partner split —
  // the owner split is derived once at the final balance (see settlement.ts).
  return row;
}

export function listExpenses(db: Db) {
  return db.select().from(schema.expenses).orderBy(desc(schema.expenses.date)).all();
}

export function getExpenseById(db: Db, id: number) {
  return db.select().from(schema.expenses).where(eq(schema.expenses.id, id)).get() ?? null;
}

export function setExpenseReceipt(db: Db, id: number, receiptUrl: string) {
  const [row] = db
    .update(schema.expenses)
    .set({ receiptUrl })
    .where(eq(schema.expenses.id, id))
    .returning()
    .all();
  return row;
}

/**
 * Edit an expense's classification (detail / category / supplier), each clearable with null.
 * Money, currency, date and the FX snapshot are entered once and intentionally NOT editable here —
 * mutating them would break the immutable-snapshot invariant.
 */
export function updateExpenseMeta(
  db: Db,
  id: number,
  input: {
    detail: string | null;
    categoryId: number | null;
    supplierId: number | null;
    // EX-8: (re)attribute the payer — including fixing imported/unattributed rows. Omit to leave
    // the payer untouched (a classification-only edit); pass null to clear back to unattributed.
    paidByUserId?: number | null;
  },
) {
  const [row] = db
    .update(schema.expenses)
    .set({
      detail: input.detail,
      categoryId: input.categoryId,
      supplierId: input.supplierId,
      ...(input.paidByUserId !== undefined ? { paidByUserId: input.paidByUserId } : {}),
    })
    .where(eq(schema.expenses.id, id))
    .returning()
    .all();
  return row;
}

export const CATEGORY_GROUPS = [
  "operating",
  "equipment",
  "maintenance",
  "taxes",
  "services",
] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export function listCategories(db: Db) {
  return db.select().from(schema.categories).orderBy(schema.categories.name).all();
}

export function createCategory(db: Db, input: { name: string; group: CategoryGroup }) {
  const name = input.name.trim();
  if (!name) throw new Error("category name required");
  if (!CATEGORY_GROUPS.includes(input.group)) throw new Error("invalid category group");
  const [row] = db.insert(schema.categories).values({ name, group: input.group }).returning().all();
  return row;
}

/** Rename a category (trimmed). Group stays as set at creation. */
export function renameCategory(db: Db, id: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("category name required");
  const [row] = db
    .update(schema.categories)
    .set({ name: trimmed })
    .where(eq(schema.categories.id, id))
    .returning()
    .all();
  return row;
}

/** Delete a category. Refuses if any expense still references it — the FK is nullable, so SQLite
 *  wouldn't stop us, but orphaning an expense's category_id loses its classification. Reassign first. */
export function deleteCategory(db: Db, id: number) {
  const [{ n }] = db
    .select({ n: count() })
    .from(schema.expenses)
    .where(eq(schema.expenses.categoryId, id))
    .all();
  if (n > 0) throw new Error(`category is in use by ${n} expense(s)`);
  db.delete(schema.categories).where(eq(schema.categories.id, id)).run();
}

/** EX-8: total EUR (cents) fronted, grouped by payer. Null payer (unattributed) gets its own bucket. */
export function expenseTotalsByUser(db: Db) {
  const nameById = new Map(listUsers(db).map((u) => [u.id, u.name]));
  // ponytail: JS aggregation over a tiny table; move to SQL GROUP BY if it ever grows.
  const totals = new Map<number | null, number>();
  for (const e of listExpenses(db)) {
    totals.set(e.paidByUserId, (totals.get(e.paidByUserId) ?? 0) + e.amountEur);
  }
  return [...totals].map(([userId, totalEur]) => ({
    userId,
    name: userId == null ? null : (nameById.get(userId) ?? null),
    totalEur,
  }));
}

/** EX-10: expenses enriched with payer name + reimbursement status for the list view.
 *  Supplier is edited inline in the ledger (a per-row select keyed on `supplierId`), so the
 *  list keeps the raw `supplierId` rather than resolving a name here. */
export function listExpensesWithPayer(db: Db) {
  const byId = new Map(listUsers(db).map((u) => [u.id, u]));
  return listExpenses(db).map((e) => {
    const payer = e.paidByUserId != null ? (byId.get(e.paidByUserId) ?? null) : null;
    return {
      ...e,
      payerUserId: e.paidByUserId,
      payerName: payer?.name ?? null,
      payerIsOwner: payer?.partnerId != null, // EX-12: only owner-paid expenses can be cash-settled
      reimbursement: reimbursementStatus(e, payer),
    };
  });
}

export type ReimbursementStatus = "not_applicable" | "pending" | "reimbursed";

/**
 * EX-9: an expense is reimbursable only when a co-host (role `user`, no owner mapping) fronted it.
 * Owner/admin-paid expenses are `not_applicable` — that's the owner's own money.
 */
export function reimbursementStatus(
  expense: { reimbursedAt: string | null },
  payer: { role: string } | null,
): ReimbursementStatus {
  if (expense.reimbursedAt != null) return "reimbursed";
  return payer?.role === "user" ? "pending" : "not_applicable";
}

/**
 * EX-9: admin reimburses a co-host's out-of-pocket expense. The cost transfers to the reimbursing
 * owner (who must map to a partner), so settlement counts it as fronted by them. Permission
 * (`reimburseExpenses`) is enforced at the route; the owner-mapping check here also blocks a co-host.
 */
export function markExpenseReimbursed(db: Db, expenseId: number, byUserId: number, date: string) {
  const expense = getExpenseById(db, expenseId);
  if (!expense) throw new Error("expense not found");
  const payer = expense.paidByUserId != null ? getUserById(db, expense.paidByUserId) : null;
  if (reimbursementStatus(expense, payer) !== "pending")
    throw new Error("only a pending co-host expense can be reimbursed");
  const reimburser = getUserById(db, byUserId);
  if (!reimburser || reimburser.partnerId == null)
    throw new Error("reimburser must be an owner (mapped to a partner)");
  const [row] = db
    .update(schema.expenses)
    .set({ reimbursedAt: date, reimbursedByUserId: byUserId })
    .where(eq(schema.expenses.id, expenseId))
    .returning()
    .all();
  return row;
}
