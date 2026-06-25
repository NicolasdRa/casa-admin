// CA-84 runner: poll each configured OTA iCal feed and sync its reserved dates into
// external_reservations (idempotent on VEVENT UID). Schedule every few hours — the feeds only
// change when a guest books/cancels on the OTA, so there's no rush, just don't let it drift a day:
//
//   # crontab — every 3 hours
//   0 */3 * * *  cd /path/to/CasaAdmin && pnpm ical:fetch >> /var/log/casa-ical.log 2>&1
//
// Money is never imported — iCal carries dates only (see [[ota-integration-ical-only]]).
import { importIcal } from "./externalReservations.ts";
import { db } from "./index.ts";
import { getSettings } from "./settings.ts";

const s = getSettings(db);
const feeds = [
  ["airbnb", s.airbnbIcalUrl],
  ["booking", s.bookingIcalUrl],
] as const;

let failed = false;
for (const [channel, url] of feeds) {
  if (!url) continue; // channel not configured — skip quietly
  try {
    const events = await importIcal(db, channel, url);
    console.log(`${channel}: synced ${events.length} reservation block(s)`);
  } catch (e) {
    // ponytail: one bad feed shouldn't sink the other; log and keep going, exit non-zero at the end.
    console.error(`${channel}: ${(e as Error).message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
