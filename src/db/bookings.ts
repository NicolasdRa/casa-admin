import { and, desc, gte, like, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { commissionEur } from "../lib/fx.ts";
import { manualSnapshot, snapshotForDate } from "./fx.ts";
import * as schema from "./schema.ts";
import { getSettings } from "./settings.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewBooking {
  guest: string;
  date: string; // ISO "YYYY-MM-DD" (check-in)
  currency: "ARS" | "EUR";
  amount: number; // cents in `currency`
  commissionRate?: number; // BK-7: defaults to the configured Settings rate; snapshotted per booking
  type?: "booking" | "cancellation" | "reimbursement";
  manualRate?: number; // FX-7: override the BNA rate (flagged); e.g. no quote for the date
}

/**
 * Record a booking, snapshotting the FX rate + commission immutably onto the row.
 * Commission rate comes from Settings (BK-7) unless overridden, and is frozen on the row so
 * historical bookings keep their rate. Cancellations/reimbursements carry no commission (BK-5).
 * Resolves the BNA rate for the check-in date (weekend/holiday falls back to the prior quote);
 * throws if none exists yet (manual override is FX-7).
 */
export function createBooking(db: Db, input: NewBooking) {
  const fx =
    input.manualRate != null
      ? manualSnapshot(input.date, input.currency, input.amount, input.manualRate)
      : snapshotForDate(db, input.date, input.currency, input.amount);
  const type = input.type ?? "booking";
  const commissionRate = input.commissionRate ?? getSettings(db).commissionRate;
  const commission = type === "booking" ? commissionEur(fx.amountEur, commissionRate) : 0;

  const [row] = db
    .insert(schema.bookings)
    .values({
      date: input.date,
      guest: input.guest,
      currency: input.currency,
      amount: input.amount,
      fxRate: fx.fxRate,
      fxRateDate: fx.fxRateDate,
      fxOverridden: input.manualRate != null,
      amountEur: fx.amountEur,
      amountArs: fx.amountArs,
      commissionRate,
      commissionEur: commission,
      type,
    })
    .returning()
    .all();
  return row;
}

export interface MonthOccupancy {
  month: string; // "YYYY-MM"
  bookings: { date: string; guest: string }[];
}

/** BK-6: actual stays grouped by month (chronological), cancellations/reimbursements excluded. */
export function occupancyByMonth(
  rows: { date: string; guest: string; type: string }[],
): MonthOccupancy[] {
  const byMonth = new Map<string, { date: string; guest: string }[]>();
  for (const r of rows) {
    if (r.type !== "booking") continue;
    const m = r.date.slice(0, 7);
    const list = byMonth.get(m) ?? [];
    list.push({ date: r.date, guest: r.guest });
    byMonth.set(m, list);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, bookings]) => ({
      month,
      bookings: bookings.sort((x, y) => x.date.localeCompare(y.date)),
    }));
}

/** BK-3: total commission accrued to the co-host across all bookings (EUR cents). */
export function accruedCommissionEur(db: Db) {
  // ponytail: JS sum over the bookings table (small); move to SUM() in SQL if it grows large.
  return db
    .select()
    .from(schema.bookings)
    .all()
    .reduce((s, b) => s + b.commissionEur, 0);
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
