import { desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { assertIsoDate } from "../lib/validate.ts";
import { accruedCommissionEur } from "./bookings.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

/** RP-7: record a payment of accrued co-host commission. */
export function createCommissionSettlement(
  db: Db,
  input: { date: string; amountEur: number; note?: string },
) {
  assertIsoDate(input.date);
  if (!Number.isInteger(input.amountEur) || input.amountEur <= 0) throw new Error("invalid amount");
  const [row] = db
    .insert(schema.commissionSettlements)
    .values({ date: input.date, amountEur: input.amountEur, note: input.note ?? null })
    .returning()
    .all();
  return row;
}

export function listCommissionSettlements(db: Db) {
  return db
    .select()
    .from(schema.commissionSettlements)
    .orderBy(desc(schema.commissionSettlements.date))
    .all();
}

export function settledCommissionEur(db: Db) {
  return listCommissionSettlements(db).reduce((s, r) => s + r.amountEur, 0);
}

/** RP-7: accrued (per booking) vs settled vs balance owed to the co-host. */
export function commissionBalance(db: Db) {
  const accrued = accruedCommissionEur(db);
  const settled = settledCommissionEur(db);
  return { accrued, settled, owed: accrued - settled };
}
