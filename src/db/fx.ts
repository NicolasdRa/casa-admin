import { desc, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { bnaAverage } from "../lib/fx.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface FxRateInput {
  date: string; // ISO "YYYY-MM-DD"
  compra: number;
  venta: number;
  source?: "BNA" | "manual";
}

/** Insert or replace the BNA quote for a date, storing the derived average. */
export function upsertFxRate(db: Db, { date, compra, venta, source = "BNA" }: FxRateInput) {
  if (!(compra > 0) || !(venta > 0)) throw new Error("compra/venta must be positive");
  const average = bnaAverage(compra, venta);
  db.insert(schema.fxRates)
    .values({ date, compra, venta, average, source })
    .onConflictDoUpdate({ target: schema.fxRates.date, set: { compra, venta, average, source } })
    .run();
  return { date, compra, venta, average, source };
}

/**
 * The quote to apply for `date`: latest on/before it (weekends/holidays fall back to the prior
 * quote). Returns null when none exists. SQL twin of `resolveRate` in lib/fx.ts — that pure
 * version is for in-memory lists (e.g. batch import / pre-save preview), this one hits the table.
 */
export function getFxRate(db: Db, date: string) {
  const rows = db
    .select()
    .from(schema.fxRates)
    .where(lte(schema.fxRates.date, date))
    .orderBy(desc(schema.fxRates.date))
    .limit(1)
    .all();
  return rows[0] ?? null;
}
