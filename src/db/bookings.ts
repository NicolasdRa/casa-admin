import { desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { commissionEur } from "../lib/fx.ts";
import { snapshotForDate } from "./fx.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewBooking {
  guest: string;
  date: string; // ISO "YYYY-MM-DD" (check-in)
  currency: "ARS" | "EUR";
  amount: number; // cents in `currency`
  commissionRate?: number; // ponytail: defaults to 0.1; read from settings once CA-71 lands (BK-7)
  type?: "booking" | "cancellation" | "reimbursement";
}

/**
 * Record a booking, snapshotting the FX rate + commission immutably onto the row.
 * Resolves the BNA rate for the check-in date (weekend/holiday falls back to the prior quote);
 * throws if none exists yet (manual override is FX-7).
 */
export function createBooking(db: Db, input: NewBooking) {
  const fx = snapshotForDate(db, input.date, input.currency, input.amount);
  const commissionRate = input.commissionRate ?? 0.1;

  const [row] = db
    .insert(schema.bookings)
    .values({
      date: input.date,
      guest: input.guest,
      currency: input.currency,
      amount: input.amount,
      fxRate: fx.fxRate,
      fxRateDate: fx.fxRateDate,
      fxOverridden: false,
      amountEur: fx.amountEur,
      amountArs: fx.amountArs,
      commissionRate,
      commissionEur: commissionEur(fx.amountEur, commissionRate),
      type: input.type ?? "booking",
    })
    .returning()
    .all();
  return row;
}

export function listBookings(db: Db) {
  return db.select().from(schema.bookings).orderBy(desc(schema.bookings.date)).all();
}
