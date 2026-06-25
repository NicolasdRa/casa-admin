import { and, desc, eq, gte, like, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { CodedError } from "../lib/errors.ts";
import { commissionEur } from "../lib/fx.ts";
import { rangesOverlap } from "../lib/overlap.ts";
import {
  assertChannel,
  assertCurrency,
  assertIsoDate,
  assertPositiveCents,
} from "../lib/validate.ts";
import { paidBookingIds } from "./cash.ts";
import { conflictsFor } from "./externalReservations.ts";
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
  type?: "booking" | "cancellation" | "damage";
  channel?: "direct" | "booking" | "airbnb"; // source platform; defaults to "direct"
  manualRate?: number; // FX-7: override the BNA rate (flagged); e.g. no quote for the date
  coHostUserId?: number | null; // co-host this booking's commission accrues to
}

/**
 * Record a booking, snapshotting the FX rate + commission immutably onto the row.
 * Commission rate comes from Settings (BK-7) unless overridden, and is frozen on the row so
 * historical bookings keep their rate. Cancellations/damage payments carry no commission (BK-5).
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
      coHostUserId: input.coHostUserId ?? null,
      type,
      channel,
    })
    .returning()
    .all();
  return row;
}

/** Delete a booking outright. A paid booking owns a cash_entries receipt (cash_entries.booking_id,
 *  RESTRICT + foreign_keys=ON), so guard like suppliers: refuse while a receipt links to it rather
 *  than let the raw FK throw — remove the Caja receipt first. The immutable FX snapshot dies with it. */
export function deleteBooking(db: Db, id: number) {
  if (paidBookingIds(db).has(id))
    throw new CodedError("hasPayment", "booking has a cash receipt — remove it in Caja first");
  db.delete(schema.bookings).where(eq(schema.bookings.id, id)).run();
}

/** Bulk-delete bookings, all-or-nothing: one transaction so a failure can't leave the selection
 *  half-deleted. Mirrors deleteSuppliers (CA-113). */
export function deleteBookings(db: Db, ids: number[]) {
  db.transaction((tx) => {
    for (const id of ids) deleteBooking(tx, id);
  });
}

export interface BookingEdit {
  guest: string;
  date?: string; // ISO check-in correction. Moves the booking on the calendar (period/year) but
  // does NOT re-snapshot FX — the frozen rate records what was actually used. Omitted = unchanged.
  channel?: "direct" | "booking" | "airbnb";
  checkOut?: string | null; // null/"" clears it
  coHostUserId?: number | null; // non-financial: re-attributing commission is allowed
}

/** Edit only the non-financial fields — guest, check-in date, channel, check-out. The FX snapshot
 *  (currency, amount, rate, amount_eur/ars, commission) is immutable and deliberately never touched
 *  here, even when the check-in date moves; correcting a money field means deleting and re-entering
 *  so a fresh snapshot is taken. */
export function editBookingDetails(db: Db, id: number, input: BookingEdit) {
  const guest = input.guest.trim();
  if (!guest) throw new CodedError("guestRequired", "guest name required");
  const [current] = db.select().from(schema.bookings).where(eq(schema.bookings.id, id)).all();
  if (!current) throw new CodedError("notFound", "booking not found");
  const channel = assertChannel(input.channel ?? current.channel);
  let date = current.date;
  if (input.date) {
    assertIsoDate(input.date);
    date = input.date;
  }
  let checkOut: string | null = null;
  if (input.checkOut) {
    assertIsoDate(input.checkOut);
    if (input.checkOut <= date)
      throw new CodedError("checkOutBeforeCheckIn", "check-out must be after check-in");
    checkOut = input.checkOut;
  }
  const [row] = db
    .update(schema.bookings)
    .set({ date, guest, channel, checkOut, coHostUserId: input.coHostUserId ?? null })
    .where(eq(schema.bookings.id, id))
    .returning()
    .all();
  return row;
}

export interface MonthOccupancy {
  month: string; // "YYYY-MM"
  nights: number; // nights booked, attributed to the check-in month
  bookings: { date: string; checkOut: string | null; guest: string; channel: string }[];
}

/** BK-6: actual stays grouped by month (chronological), cancellations/damage payments excluded. */
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

export interface MonthView extends MonthOccupancy {
  blocks: { start: string; end: string; channel: string; summary: string | null }[];
}

/** CA-86: fold imported OTA reservation blocks into the per-month occupancy view so the calendar
 *  shows synced Airbnb/Booking dates beside real bookings. A block attaches to its start month and
 *  can create a month entry where there's no direct booking. Nights are NOT inflated — blocks are
 *  availability only (no money/commission). Everything sorts newest-first (months, bookings, blocks)
 *  to match the /bookings list; occupancyByMonth's own asc contract is left intact (re-sorted here). */
export function mergeOccupancy(
  months: MonthOccupancy[],
  reservations: { start: string; end: string; channel: string; summary?: string | null }[],
): MonthView[] {
  const byMonth = new Map<string, MonthView>();
  for (const m of months) byMonth.set(m.month, { ...m, blocks: [] });
  for (const r of reservations) {
    const key = r.start.slice(0, 7);
    const entry = byMonth.get(key) ?? { month: key, nights: 0, bookings: [], blocks: [] };
    entry.blocks.push({
      start: r.start,
      end: r.end,
      channel: r.channel,
      summary: r.summary ?? null,
    });
    byMonth.set(key, entry);
  }
  return [...byMonth.values()]
    .map((m) => ({
      ...m,
      bookings: [...m.bookings].sort((a, b) => b.date.localeCompare(a.date)),
      blocks: m.blocks.sort((a, b) => b.start.localeCompare(a.start)),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

export interface Conflict {
  source: "booking" | "ota";
  channel: string;
  start: string;
  end: string;
  label: string | null; // guest name (booking) or feed summary (ota)
}

/** CA-86: existing bookings + imported OTA blocks whose date range overlaps [start, end), honoring
 *  the configured clear-day gap. Only ranged bookings (checkOut set) can overlap; cancellations and
 *  damage payments are skipped. Pass excludeBookingId to re-check an edited row against everything but
 *  itself. Non-blocking by design — the caller warns, it doesn't reject. */
export function findConflicts(
  db: Db,
  start: string,
  end: string,
  opts: { gapDays?: number; excludeBookingId?: number } = {},
): Conflict[] {
  const gap = opts.gapDays ?? getSettings(db).bookingGapDays;
  const fromBookings = listBookings(db)
    .filter(
      (b) =>
        b.id !== opts.excludeBookingId &&
        b.type === "booking" &&
        b.checkOut != null &&
        rangesOverlap(start, end, b.date, b.checkOut, gap),
    )
    .map((b) => ({
      source: "booking" as const,
      channel: b.channel,
      start: b.date,
      end: b.checkOut as string,
      label: b.guest,
    }));
  const fromOta = conflictsFor(db, start, end, gap).map((r) => ({
    source: "ota" as const,
    channel: r.channel,
    start: r.start,
    end: r.end,
    label: r.summary,
  }));
  return [...fromBookings, ...fromOta];
}

/** Occupancy as a % of the calendar month's nights. daysInMonth via day-0 of the next month
 *  (leap-aware, no special-casing). Can exceed 100% when a boundary-spanning stay credits all
 *  its nights to the check-in month (see occupancyByMonth's ponytail note). */
export function occupancyPct(month: string, nights: number) {
  const [y, m] = month.split("-").map(Number);
  return Math.round((nights / new Date(y, m, 0).getDate()) * 100);
}

/** Rental income (EUR cents): gross of every booking row, including cancellation fees and
 *  damage payments (real money in; legacy-sheet parity). Commission still accrues only on bookings. */
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
  coHostUserId?: number; // commission accrues to this co-host
}

export function listBookings(db: Db, filter: BookingFilter = {}) {
  const conds = [];
  if (filter.year) conds.push(like(schema.bookings.date, `${filter.year}-%`));
  // ponytail: LIKE is case-insensitive for ASCII only; accented names match case-sensitively. Fine for now.
  if (filter.guest) conds.push(like(schema.bookings.guest, `%${filter.guest}%`));
  if (filter.from) conds.push(gte(schema.bookings.date, filter.from));
  if (filter.to) conds.push(lte(schema.bookings.date, filter.to));
  if (filter.channel) conds.push(eq(schema.bookings.channel, filter.channel));
  if (filter.coHostUserId) conds.push(eq(schema.bookings.coHostUserId, filter.coHostUserId));
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
