import { and, desc, gte, like, lte } from "drizzle-orm";
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

export interface BookingFilter {
  year?: string; // "YYYY"
  guest?: string; // substring match
  from?: string; // ISO date, inclusive
  to?: string; // ISO date, inclusive
}

export function listBookings(db: Db, filter: BookingFilter = {}) {
  const conds = [];
  if (filter.year) conds.push(like(schema.bookings.date, `${filter.year}-%`));
  // ponytail: LIKE is case-insensitive for ASCII only; accented names match case-sensitively. Fine for now.
  if (filter.guest) conds.push(like(schema.bookings.guest, `%${filter.guest}%`));
  if (filter.from) conds.push(gte(schema.bookings.date, filter.from));
  if (filter.to) conds.push(lte(schema.bookings.date, filter.to));
  return db
    .select()
    .from(schema.bookings)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.bookings.date))
    .all();
}

export interface YearSummary {
  year: string;
  count: number;
  incomeEur: number;
  incomeArs: number;
  commissionEur: number;
}

type SummaryRow = Pick<
  typeof schema.bookings.$inferSelect,
  "date" | "amountEur" | "amountArs" | "commissionEur"
>;

/** Per-year subtotals (newest year first) plus a grand total. All sums are integer cents. */
export function summarizeBookings(rows: SummaryRow[]) {
  const byYear = new Map<string, YearSummary>();
  for (const r of rows) {
    const year = r.date.slice(0, 4);
    const s = byYear.get(year) ?? { year, count: 0, incomeEur: 0, incomeArs: 0, commissionEur: 0 };
    s.count++;
    s.incomeEur += r.amountEur;
    s.incomeArs += r.amountArs;
    s.commissionEur += r.commissionEur;
    byYear.set(year, s);
  }
  const years = [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year));
  const total = years.reduce<YearSummary>(
    (t, s) => ({
      year: "",
      count: t.count + s.count,
      incomeEur: t.incomeEur + s.incomeEur,
      incomeArs: t.incomeArs + s.incomeArs,
      commissionEur: t.commissionEur + s.commissionEur,
    }),
    { year: "", count: 0, incomeEur: 0, incomeArs: 0, commissionEur: 0 },
  );
  return { years, total };
}
