import { count, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { CodedError } from "../lib/errors.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

/** Add a supplier (trimmed). Idempotent by name, case-insensitive — returns the existing row
 *  if one matches, so the reusable list stays free of near-duplicates (EX-5). */
export function createSupplier(db: Db, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new CodedError("nameRequired", "supplier name required");
  // ponytail: linear scan over the supplier list (tiny); switch to a lower(name) index if it ever grows.
  const existing = listSuppliers(db).find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  const [row] = db.insert(schema.suppliers).values({ name: trimmed }).returning().all();
  return row;
}

export function listSuppliers(db: Db) {
  return db.select().from(schema.suppliers).orderBy(schema.suppliers.name).all();
}

/** Rename a supplier (trimmed). Rejects empty names and collisions with a *different* supplier
 *  (case-insensitive) so the dedup invariant from createSupplier holds under edits too. */
export function renameSupplier(db: Db, id: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new CodedError("nameRequired", "supplier name required");
  // ponytail: linear scan, same as createSupplier — fine at this size.
  const clash = listSuppliers(db).find(
    (s) => s.id !== id && s.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) throw new CodedError("duplicate", `supplier "${trimmed}" already exists`);
  const [row] = db
    .update(schema.suppliers)
    .set({ name: trimmed })
    .where(eq(schema.suppliers.id, id))
    .returning()
    .all();
  return row;
}

/** Delete a supplier. Refuses if any expense still references it — the FK is nullable, so SQLite
 *  wouldn't stop us, but orphaning an expense's supplier_id loses history. Reassign first. */
export function deleteSupplier(db: Db, id: number) {
  const [{ n }] = db
    .select({ n: count() })
    .from(schema.expenses)
    .where(eq(schema.expenses.supplierId, id))
    .all();
  if (n > 0) throw new CodedError("inUse", `supplier is in use by ${n} expense(s)`);
  db.delete(schema.suppliers).where(eq(schema.suppliers.id, id)).run();
}
