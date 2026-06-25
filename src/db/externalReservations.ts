import { and, eq, gte, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { parseIcs } from "../lib/ical.ts";
import { rangesOverlap } from "../lib/overlap.ts";
import * as schema from "./schema.ts";
import { getSettings } from "./settings.ts";

type Db = BetterSQLite3Database<typeof schema>;
type Channel = "booking" | "airbnb";

/**
 * Upsert a channel's iCal events, keyed on VEVENT UID so a re-fetch updates in place (idempotent).
 * Events that vanish from the feed (a cancelled OTA reservation) are pruned: we replace the whole
 * channel's set in one transaction. ponytail: full replace per channel is fine at this scale (one
 * listing, a handful of future blocks); switch to a diff if a feed ever returns thousands of rows.
 */
export function upsertReservations(
  db: Db,
  channel: Channel,
  events: { uid: string; start: string; end: string; summary?: string }[],
) {
  db.transaction((tx) => {
    tx.delete(schema.externalReservations)
      .where(eq(schema.externalReservations.channel, channel))
      .run();
    for (const e of events) {
      tx.insert(schema.externalReservations)
        .values({ uid: e.uid, channel, start: e.start, end: e.end, summary: e.summary ?? null })
        .run();
    }
  });
}

/** Imported reservation blocks, optionally clipped to a date window (by start date). */
export function listReservations(db: Db, range: { from?: string; to?: string } = {}) {
  const conds = [];
  if (range.from) conds.push(gte(schema.externalReservations.start, range.from));
  if (range.to) conds.push(lte(schema.externalReservations.start, range.to));
  return db
    .select()
    .from(schema.externalReservations)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(schema.externalReservations.start)
    .all();
}

/**
 * CA-86: imported OTA blocks that overlap a candidate stay [start, end). Used by the booking-entry
 * guard. The required clear-day gap comes from Settings (default 0 = back-to-back allowed); pass
 * `gapDays` to override (e.g. tests). The overlap test is the half-open predicate in lib/overlap.ts.
 * ponytail: scans all blocks in JS — trivial at this scale; add a SQL range filter if it grows.
 */
export function conflictsFor(db: Db, start: string, end: string, gapDays?: number) {
  const gap = gapDays ?? getSettings(db).bookingGapDays;
  return listReservations(db).filter((r) => rangesOverlap(start, end, r.start, r.end, gap));
}

/** Fetch a channel's iCal feed and store its events. fetchImpl injectable for tests. */
export async function importIcal(
  db: Db,
  channel: Channel,
  url: string,
  fetchImpl: typeof fetch = fetch,
) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`iCal fetch failed (${channel}): ${res.status}`);
  const events = parseIcs(await res.text());
  upsertReservations(db, channel, events);
  return events;
}
