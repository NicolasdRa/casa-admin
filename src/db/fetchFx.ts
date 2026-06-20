// FX-8 runner: fetch today's BNA "Billetes" EUR quote and upsert it. Run manually or from cron:
//   pnpm fx:fetch     (e.g. a daily crontab entry on the server)
import { importBnaEur } from "./bna.ts";
import { db } from "./index.ts";

const today = new Date().toISOString().slice(0, 10);
try {
  const row = await importBnaEur(db, today);
  console.log(`BNA EUR ${today}: compra ${row.compra} venta ${row.venta} (avg ${row.average})`);
} catch (e) {
  console.error("BNA fetch failed:", (e as Error).message);
  process.exit(1);
}
