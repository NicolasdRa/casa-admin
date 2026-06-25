import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { CodedError } from "../lib/errors.ts";
import { assertIsoDate } from "../lib/validate.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewCashEntry {
  date: string;
  partnerId: number;
  concept: string;
  amountEur: number; // signed cents: + contribution/allocation/income, - withdrawal
  type: "contribution" | "withdrawal" | "allocation" | "income";
  bookingId?: number; // set only on "income" entries (rent receipt → links back to the booking)
}

export function createCashEntry(db: Db, input: NewCashEntry) {
  assertIsoDate(input.date);
  const concept = input.concept.trim();
  if (!concept) throw new Error("concept required");
  const [row] = db
    .insert(schema.cashEntries)
    .values({ ...input, concept })
    .returning()
    .all();
  return row;
}

export interface RegisterBookingPayment {
  bookingId: number;
  partnerId: number; // whose account actually received the cash
  date: string; // when the cash landed (ISO)
  amountEur?: number; // defaults to the booking's EUR amount — the full rent
  concept?: string; // defaults to a type-aware "Cobro …: <guest>" (see cobroConcept)
}

// Default Caja concept prefix per booking type, so a collected cancellation/damage reads correctly
// instead of "Cobro alquiler". Spanish to match the rest of the ledger's stored concepts.
const cobroConcept: Record<string, string> = {
  booking: "Cobro alquiler",
  cancellation: "Cobro cancelación",
  damage: "Cobro daños",
};

/** Record that a booking's rent was physically received into a partner's account, as an "income"
 *  Caja movement linked back to the booking. Bookings stay the source of truth for the income column;
 *  this only moves the partner's cash balance. Idempotent: one receipt per booking — re-registering
 *  throws, so the balance can't double-count. */
export function registerBookingPayment(db: Db, input: RegisterBookingPayment) {
  assertIsoDate(input.date);
  const booking = db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.id, input.bookingId))
    .get();
  if (!booking) throw new CodedError("bookingNotFound", "booking not found");
  if (paidBookingIds(db).has(input.bookingId))
    throw new CodedError("alreadyRegistered", "booking payment already registered");

  return createCashEntry(db, {
    date: input.date,
    partnerId: input.partnerId,
    concept: input.concept?.trim() || `${cobroConcept[booking.type] ?? "Cobro"}: ${booking.guest}`,
    amountEur: input.amountEur ?? booking.amountEur, // cash in → positive
    type: "income",
    bookingId: input.bookingId,
  });
}

/** Each booking's cash receipt — its entry id + the date it was registered. Drives the row's
 *  Cobrado/Pendiente status and lets a superadmin correct the registration date. */
export function bookingPayments(db: Db): { id: number; bookingId: number; date: string }[] {
  return db
    .select({
      id: schema.cashEntries.id,
      bookingId: schema.cashEntries.bookingId,
      date: schema.cashEntries.date,
    })
    .from(schema.cashEntries)
    .where(eq(schema.cashEntries.type, "income"))
    .all()
    .filter((r): r is { id: number; bookingId: number; date: string } => r.bookingId != null);
}

/** Booking ids that already have a linked cash receipt — gates "Registrar cobro" so it can't fire
 *  twice and flips the row chip to Cobrado. */
export function paidBookingIds(db: Db): Set<number> {
  return new Set(bookingPayments(db).map((p) => p.bookingId));
}

/** Correct a cash movement's date (superadmin fix for a mis-dated cobro). Only the date moves —
 *  the running balance re-sorts and recomputes on next read. The money snapshot is untouched. */
export function editCashEntryDate(db: Db, id: number, date: string) {
  assertIsoDate(date);
  const [row] = db
    .update(schema.cashEntries)
    .set({ date })
    .where(eq(schema.cashEntries.id, id))
    .returning()
    .all();
  if (!row) throw new CodedError("notFound", "cash entry not found");
  return row;
}

/** Delete a cash entry — the fix path for a mistyped movement (entries are append-only otherwise).
 *  Leaf row: nothing references it, so the running balance simply recomputes on next read. */
export function deleteCashEntry(db: Db, id: number) {
  db.delete(schema.cashEntries).where(eq(schema.cashEntries.id, id)).run();
}

/** CA-1: the Caja ledger in date order with a cumulative running balance. */
export function listCashLedger(db: Db) {
  const rows = db
    .select()
    .from(schema.cashEntries)
    .orderBy(asc(schema.cashEntries.date), asc(schema.cashEntries.id))
    .all();
  let balance = 0;
  return rows.map((r) => {
    balance += r.amountEur;
    return { ...r, runningBalance: balance };
  });
}
