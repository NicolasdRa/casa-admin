import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

/** Add a supplier (trimmed). Idempotent by name, case-insensitive — returns the existing row
 *  if one matches, so the reusable list stays free of near-duplicates (EX-5). */
export function createSupplier(db: Db, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("supplier name required");
  // ponytail: linear scan over the supplier list (tiny); switch to a lower(name) index if it ever grows.
  const existing = listSuppliers(db).find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  const [row] = db.insert(schema.suppliers).values({ name: trimmed }).returning().all();
  return row;
}

export function listSuppliers(db: Db) {
  return db.select().from(schema.suppliers).orderBy(schema.suppliers.name).all();
}
