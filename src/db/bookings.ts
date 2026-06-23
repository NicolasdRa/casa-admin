import { and, desc, eq, gte, like, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { CodedError } from "../lib/errors.ts";
import { commissionEur } from "../lib/fx.ts";
import {
  assertChannel,
  assertCurrency,
  assertIsoDate,
  assertPositiveCents,
} from "../lib/validate.ts";
import { manualSnapshot, snapshotForDate } from "./fx.ts";
import * as schema from "./schema.ts";
import { getSettings } from "./settings.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewBooking {
  guest: string;
  date: string; // ISO "YYYY-MM-DD" (check-in)
  checkOut?: string; // CA-83: ISO check-out, must be > date; omitted for single-point/legacy rows
  currency: "ARS" | "EUR";
  amount: number; // cents in `currency`
  commissionRate?: number; // BK-7: defaults to the configured Settings rate; snapshotted per booking
  type?: "booking" | "cancellation" | "reimbursement";
  channel?: "direct" | "booking" | "airbnb"; // source platform; defaults to "direct"
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
  assertIsoDate(input.date);
  assertCurrency(input.currency);
  assertPositiveCents(input.amount);
  const channel = assertChannel(input.channel ?? "direct");
  // CA-83: check-out is optional, but when given it must be strictly after check-in (≥ 1 night).
  // ISO dates sort lexically, so a string compare is the date compare.
  let checkOut: string | null = null;
  if (input.checkOut) {
    assertIsoDate(input.checkOut);
    if (input.checkOut <= input.date)
      throw new CodedError("checkOutBeforeCheckIn", "check-out must be after check-in");
    checkOut = input.checkOut;
  }
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
      checkOut,
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
      channel,
    })
    .returning()
    .all();
  return row;
}

export interface MonthOccupancy {
  month: string; // "YYYY-MM"
  nights: number; // nights booked, attributed to the check-in month
  bookings: { date: string; checkOut: string | null; guest: string; channel: string }[];
}

/** BK-6: actual stays grouped by month (chronological), cancellations/reimbursements excluded. */
export function occupancyByMonth(
  rows: { date: string; checkOut?: string | null; guest: string; type: string; channel?: string }[],
): MonthOccupancy[] {
  const byMonth = new Map<string, MonthOccupancy["bookings"]>();
  for (const r of rows) {
    if (r.type !== "booking") continue;
    const m = r.date.slice(0, 7);
    const list = byMonth.get(m) ?? [];
    list.push({
      date: r.date,
      checkOut: r.checkOut ?? null,
      guest: r.guest,
      channel: r.channel ?? "direct",
    });
    byMonth.set(m, list);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, bookings]) => ({
      month,
      // ponytail: nights credited to the check-in month; a stay spanning a boundary
      // still counts wholly here. Split per calendar month only if cross-month % matters.
      nights: bookings.reduce(
        (n, b) => n + (b.checkOut ? (Date.parse(b.checkOut) - Date.parse(b.date)) / 86_400_000 : 0),
        0,
      ),
      bookings: bookings.sort((x, y) => x.date.localeCompare(y.date)),
    }));
}

/** Rental income (EUR cents): gross of every booking row, including cancellation fees and
 *  reimbursements (real money in; legacy-sheet parity). Commission still accrues only on bookings. */
export function rentalIncomeEur(db: Db) {
  return db
    .select()
    .from(schema.bookings)
    .all()
    .reduce((s, b) => s + b.amountEur, 0);
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
  channel?: "direct" | "booking" | "airbnb";
}

export function listBookings(db: Db, filter: BookingFilter = {}) {
  const conds = [];
  if (filter.year) conds.push(like(schema.bookings.date, `${filter.year}-%`));
  // ponytail: LIKE is case-insensitive for ASCII only; accented names match case-sensitively. Fine for now.
  if (filter.guest) conds.push(like(schema.bookings.guest, `%${filter.guest}%`));
  if (filter.from) conds.push(gte(schema.bookings.date, filter.from));
  if (filter.to) conds.push(lte(schema.bookings.date, filter.to));
  if (filter.channel) conds.push(eq(schema.bookings.channel, filter.channel));
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
