import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { assertIsoDate } from "../lib/validate.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewCashEntry {
  date: string;
  partnerId: number;
  concept: string;
  amountEur: number; // signed cents: + contribution/allocation, - withdrawal
  type: "contribution" | "withdrawal" | "allocation";
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
