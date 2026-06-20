import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { upsertFxRate } from "./fx.ts";
import type * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

// BNA cotizaciones page; we use "Cotización billetes" (cash quote) per the product decision.
// ⚠️ The exact live markup should be validated before production — parseBnaEur is best-effort
// against the published "Billetes" table.
const BNA_URL = "https://www.bna.com.ar/Personas";

/** Parse an es-AR formatted number ("1.085,50" -> 1085.5). */
export function parseArNumber(s: string): number {
  const n = Number(s.trim().replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`unparseable number: ${s}`);
  return n;
}

/** Extract EUR compra/venta from the BNA "Billetes" table (not Divisas). */
export function parseBnaEur(html: string): { compra: number; venta: number } {
  // Scope to the Billetes section: from its heading up to the Divisas section (if present).
  const start = html.search(/billetes/i);
  let scope = start >= 0 ? html.slice(start) : html;
  const divisas = scope.search(/divisas/i);
  if (divisas > 0) scope = scope.slice(0, divisas);

  const row = /Euro[\s\S]*?<\/tr>/i.exec(scope);
  if (!row) throw new Error("BNA: EUR row not found in Billetes table");
  const nums = row[0].match(/\d{1,3}(?:\.\d{3})*,\d{2}/g);
  if (!nums || nums.length < 2) throw new Error("BNA: EUR compra/venta not found");
  return { compra: parseArNumber(nums[0]), venta: parseArNumber(nums[1]) };
}

/** Fetch + parse today's EUR quote from BNA. fetchImpl injectable for testing. */
export async function fetchBnaEur(fetchImpl: typeof fetch = fetch, url = BNA_URL) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`BNA fetch failed: ${res.status}`);
  return parseBnaEur(await res.text());
}

/** Fetch BNA's EUR quote and upsert it into the rate table for `date`. */
export async function importBnaEur(db: Db, date: string, fetchImpl: typeof fetch = fetch) {
  const { compra, venta } = await fetchBnaEur(fetchImpl);
  return upsertFxRate(db, { date, compra, venta, source: "BNA" });
}
