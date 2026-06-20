import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export function createPartner(db: Db, p: { name: string; defaultShare?: number }) {
  const [row] = db
    .insert(schema.partners)
    .values({ name: p.name, defaultShare: p.defaultShare ?? 0.5 })
    .returning()
    .all();
  return row;
}

export function listPartners(db: Db) {
  return db.select().from(schema.partners).all();
}
