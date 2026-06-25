import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { CodedError } from "../lib/errors.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

// Constrained vocabularies — the form renders these as selects, and parseSettings rejects
// anything else so a crafted POST can't persist a garbage source/cadence.
export const FX_SOURCES = ["BNA"] as const;
export const BACKUP_CADENCES = ["daily", "weekly", "monthly", "off"] as const;

export type SettingsPatch = Partial<{
  commissionRate: number;
  fxSource: string;
  defaultLocale: "es" | "en";
  backupCadence: string;
  airbnbIcalUrl: string | null;
  bookingIcalUrl: string | null;
  bookingGapDays: number;
}>;

/** Trim an iCal URL field. Blank clears it (null); a non-blank value must be a valid http(s) URL,
 *  else throw so the form reports it rather than silently storing a feed that will never fetch. */
function parseIcalUrl(raw: FormDataEntryValue | null): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new CodedError("icalUrlInvalid", `invalid iCal URL: ${v}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new CodedError("icalUrlInvalid", `iCal URL must be http(s): ${v}`);
  return v;
}

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
  try {
    // Only patch when the field is present, so a form that omits it can't clobber a stored URL.
    if (form.has("airbnbIcalUrl")) patch.airbnbIcalUrl = parseIcalUrl(form.get("airbnbIcalUrl"));
    if (form.has("bookingIcalUrl")) patch.bookingIcalUrl = parseIcalUrl(form.get("bookingIcalUrl"));
  } catch (e) {
    return { error: e instanceof CodedError ? e.code : "icalUrlInvalid" };
  }
  const gapRaw = form.get("bookingGapDays");
  if (gapRaw != null && String(gapRaw).trim() !== "") {
    const gap = Number(gapRaw);
    if (!Number.isInteger(gap) || gap < 0) return { error: "gapInvalid" };
    patch.bookingGapDays = gap;
  }
  const pctRaw = form.get("commissionPct");
  if (pctRaw != null && String(pctRaw).trim() !== "") {
    const pct = Number(pctRaw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: "commissionInvalid" };
    patch.commissionRate = pct / 100;
  }
  const locale = form.get("defaultLocale");
  if (locale === "es" || locale === "en") patch.defaultLocale = locale;
  // Allowlist-skip (same shape as locale above): only a supported value is persisted.
  const fxSource = String(form.get("fxSource") ?? "").trim();
  if ((FX_SOURCES as readonly string[]).includes(fxSource)) patch.fxSource = fxSource;
  const backup = String(form.get("backupCadence") ?? "").trim();
  if ((BACKUP_CADENCES as readonly string[]).includes(backup)) patch.backupCadence = backup;
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
