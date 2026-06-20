import { desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { snapshotForDate } from "./fx.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewExpense {
  date: string; // ISO "YYYY-MM-DD"
  currency: "ARS" | "EUR";
  amount: number; // cents in `currency`
  detail?: string;
  categoryId?: number;
  supplierId?: number; // ponytail: free now; managed supplier list is EX-5
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
      fxRate: fx.fxRate,
      fxRateDate: fx.fxRateDate,
      fxOverridden: false,
      amountEur: fx.amountEur,
      amountArs: fx.amountArs,
    })
    .returning()
    .all();
  return row;
}

export function listExpenses(db: Db) {
  return db.select().from(schema.expenses).orderBy(desc(schema.expenses.date)).all();
}

export function listCategories(db: Db) {
  return db.select().from(schema.categories).orderBy(schema.categories.name).all();
}
