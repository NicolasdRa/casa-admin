import { asc } from "drizzle-orm";
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
