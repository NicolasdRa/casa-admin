import { and, desc, eq, gte, like, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { assertIsoDate } from "../lib/validate.ts";
import { accruedCommissionEur } from "./bookings.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

/** RP-7: record a payment of accrued co-host commission. */
export function createCommissionSettlement(
  db: Db,
  input: { date: string; amountEur: number; note?: string; coHostUserId?: number | null },
) {
  assertIsoDate(input.date);
  if (!Number.isInteger(input.amountEur) || input.amountEur <= 0) throw new Error("invalid amount");
  const [row] = db
    .insert(schema.commissionSettlements)
    .values({
      date: input.date,
      coHostUserId: input.coHostUserId ?? null,
      amountEur: input.amountEur,
      note: input.note ?? null,
    })
    .returning()
    .all();
  return row;
}

/** Edit a settlement (superadmin correction). Same validation as create; throws on a missing id. */
export function updateCommissionSettlement(
  db: Db,
  id: number,
  input: { date: string; amountEur: number; note?: string; coHostUserId?: number | null },
) {
  assertIsoDate(input.date);
  if (!Number.isInteger(input.amountEur) || input.amountEur <= 0) throw new Error("invalid amount");
  const [row] = db
    .update(schema.commissionSettlements)
    .set({
      date: input.date,
      coHostUserId: input.coHostUserId ?? null,
      amountEur: input.amountEur,
      note: input.note ?? null,
    })
    .where(eq(schema.commissionSettlements.id, id))
    .returning()
    .all();
  if (!row) throw new Error("settlement not found");
  return row;
}

/** Delete a settlement (superadmin correction). No dependents, so it's an unconditional removal. */
export function deleteCommissionSettlement(db: Db, id: number) {
  db.delete(schema.commissionSettlements).where(eq(schema.commissionSettlements.id, id)).run();
}

export interface SettlementFilter {
  year?: string; // "YYYY"
  from?: string; // ISO date, inclusive
  to?: string; // ISO date, inclusive
  coHostUserId?: number; // settlements paid to this co-host
}

/** Settlement history, newest first. Same date-filter semantics as listBookings. */
export function listCommissionSettlements(db: Db, filter: SettlementFilter = {}) {
  const col = schema.commissionSettlements.date;
  const conds = [];
  if (filter.year) conds.push(like(col, `${filter.year}-%`));
  if (filter.from) conds.push(gte(col, filter.from));
  if (filter.to) conds.push(lte(col, filter.to));
  if (filter.coHostUserId)
    conds.push(eq(schema.commissionSettlements.coHostUserId, filter.coHostUserId));
  return db
    .select()
    .from(schema.commissionSettlements)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(col))
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

export interface CoHostBalance {
  coHostUserId: number | null; // null = unattributed (legacy / no co-host chosen)
  accrued: number;
  settled: number;
  owed: number;
}

/** Per-co-host commission balance: accrued from each booking's co-host, settled from each
 *  settlement's co-host. Sums to commissionBalance(). Co-host ids resolved to names by the caller. */
export function commissionBalanceByCoHost(db: Db): CoHostBalance[] {
  const acc = new Map<number | null, { accrued: number; settled: number }>();
  const slot = (id: number | null) => {
    let e = acc.get(id);
    if (!e) {
      e = { accrued: 0, settled: 0 };
      acc.set(id, e);
    }
    return e;
  };
  for (const b of db.select().from(schema.bookings).all()) {
    if (b.commissionEur) slot(b.coHostUserId).accrued += b.commissionEur;
  }
  for (const s of listCommissionSettlements(db)) slot(s.coHostUserId).settled += s.amountEur;
  return [...acc.entries()]
    .map(([coHostUserId, e]) => ({ coHostUserId, ...e, owed: e.accrued - e.settled }))
    .sort((a, b) => (a.coHostUserId ?? Infinity) - (b.coHostUserId ?? Infinity)); // nulls last
}
