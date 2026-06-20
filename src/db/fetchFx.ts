// FX-8 runner: fetch today's BNA "Billetes" EUR quote and upsert it. Keeps a daily record of rates
// so getFxRate always has fresh data (the on-the-fly fetch at expense entry, CA-89, is just a gap
// filler). Schedule it once a day shortly after BNA publishes, ~14:00 Argentina time:
//
//   # crontab — runs at 14:00 America/Argentina/Buenos_Aires (UTC-3, no DST → 17:00 UTC)
//   CRON_TZ=America/Argentina/Buenos_Aires
//   0 14 * * *  cd /path/to/CasaAdmin && pnpm fx:fetch >> /var/log/casa-fx.log 2>&1
//
// (If your cron ignores CRON_TZ, use `0 17 * * *` in UTC instead.)
import { importBnaEur } from "./bna.ts";
import { db } from "./index.ts";

const today = new Date().toISOString().slice(0, 10);

// ponytail: 3 tries with linear backoff — BNA's F5 WAF 503s intermittently, so a once-a-day job
// shouldn't give up on a transient block. Upsert is idempotent, so a re-run is harmless.
const RETRIES = 3;
for (let attempt = 1; attempt <= RETRIES; attempt++) {
  try {
    const row = await importBnaEur(db, today);
    console.log(`BNA EUR ${today}: compra ${row.compra} venta ${row.venta} (avg ${row.average})`);
    process.exit(0);
  } catch (e) {
    console.error(`BNA fetch attempt ${attempt}/${RETRIES} failed:`, (e as Error).message);
    if (attempt < RETRIES) await new Promise((r) => setTimeout(r, attempt * 5000));
  }
}
process.exit(1);
