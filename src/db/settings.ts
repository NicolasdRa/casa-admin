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

/**
 * Validate the settings form into a patch, or an error code. An out-of-range commission is
 * rejected (not silently dropped) so the UI reports it instead of claiming a save that didn't
 * happen — the commission rate drives money math. A blank commission is skipped, not zeroed.
 */
export function parseSettings(form: FormData): { patch: SettingsPatch } | { error: string } {
  const patch: SettingsPatch = {};
  const pctRaw = form.get("commissionPct");
  if (pctRaw != null && String(pctRaw).trim() !== "") {
    const pct = Number(pctRaw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: "commissionInvalid" };
    patch.commissionRate = pct / 100;
  }
  const locale = form.get("defaultLocale");
  if (locale === "es" || locale === "en") patch.defaultLocale = locale;
  const fxSource = String(form.get("fxSource") ?? "").trim();
  if (fxSource) patch.fxSource = fxSource;
  const backup = String(form.get("backupCadence") ?? "").trim();
  if (backup) patch.backupCadence = backup;
  return { patch };
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
