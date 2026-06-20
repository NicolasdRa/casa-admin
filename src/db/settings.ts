import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export type SettingsPatch = Partial<{
  commissionRate: number;
  fxSource: string;
  defaultLocale: "es" | "en";
  backupCadence: string;
}>;

/** App-wide settings as a single row, lazily created with schema defaults on first read. */
export function getSettings(db: Db) {
  const existing = db.select().from(schema.settings).get();
  if (existing) return existing;
  const [row] = db.insert(schema.settings).values({}).returning().all();
  return row;
}

export function updateSettings(db: Db, patch: SettingsPatch) {
  const current = getSettings(db);
  const [row] = db
    .update(schema.settings)
    .set(patch)
    .where(eq(schema.settings.id, current.id))
    .returning()
    .all();
  return row;
}
