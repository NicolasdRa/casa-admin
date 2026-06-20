import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { splitByShare } from "../lib/split.ts";
import { snapshotForDate } from "./fx.ts";
import { listPartners } from "./partners.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewExpense {
  date: string; // ISO "YYYY-MM-DD"
  currency: "ARS" | "EUR";
  amount: number; // cents in `currency`
  detail?: string;
  categoryId?: number;
  supplierId?: number;
  receiptUrl?: string; // EX-6: stored receipt filename, served via /api/receipt
}

/** Lowercased file extension restricted to [a-z0-9] (max 5). "" if none — guards against odd names. */
export function safeExt(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(filename);
  return m ? m[1].toLowerCase() : "";
}

/** Record an expense, snapshotting the FX rate + both currencies immutably onto the row. */
export function createExpense(db: Db, input: NewExpense) {
  const fx = snapshotForDate(db, input.date, input.currency, input.amount);
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
      fxRate: fx.fxRate,
      fxRateDate: fx.fxRateDate,
      fxOverridden: false,
      amountEur: fx.amountEur,
      amountArs: fx.amountArs,
    })
    .returning()
    .all();

  // EX-3: split the EUR total across partners by their default share (largest-remainder, no lost cents).
  // Only when partners exist and their shares sum to ~1; otherwise skip rather than persist an unbalanced split.
  const partners = listPartners(db);
  const shareSum = partners.reduce((s, p) => s + p.defaultShare, 0);
  if (partners.length > 0 && Math.abs(shareSum - 1) < 1e-9) {
    const splits = splitByShare(
      row.amountEur,
      partners.map((p) => ({ partnerId: p.id, share: p.defaultShare })),
    );
    db.insert(schema.expenseSplits)
      .values(
        splits.map((s) => ({ expenseId: row.id, partnerId: s.partnerId, amountEur: s.amountEur })),
      )
      .run();
  }
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

/** Aggregate each partner's total expense share (EUR cents) across all splits. */
export function expenseTotalsByPartner(db: Db) {
  const partners = listPartners(db);
  // ponytail: JS aggregation over a tiny split table; move to a SQL GROUP BY if it ever grows.
  const splits = db.select().from(schema.expenseSplits).all();
  return partners.map((p) => ({
    partnerId: p.id,
    name: p.name,
    totalEur: splits.filter((s) => s.partnerId === p.id).reduce((a, s) => a + s.amountEur, 0),
  }));
}
