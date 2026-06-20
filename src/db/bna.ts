import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { resolveRate } from "../lib/fx.ts";
import { getFxRate, upsertFxRate } from "./fx.ts";
import type * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

// BNA cotizaciones; we use "Cotización billetes" (cash quote) per the product decision.
// ⚠️ The exact live markup should be validated before production — the parsers are best-effort
// against the published "Billetes" tables.
const BNA_URL = "https://www.bna.com.ar/Personas";
const HISTORIC_URL = "https://www.bna.com.ar/Cotizador/HistoricoPrincipales";
const EURO_FILTRO_MONEDA = "12"; // BNA currency id for Euro in the historico filter (Dolar=22, Real=23)

// BNA sits behind an F5 WAF that rejects header-less requests with a 503 "URL was rejected" page,
// so every request must look like a browser. Verified: with these headers /Personas returns 200.
const BNA_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-AR,es;q=0.9",
};

/** Parse an es-AR formatted number ("1.085,50" -> 1085.5). */
export function parseArNumber(s: string): number {
  const n = Number(s.trim().replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`unparseable number: ${s}`);
  return n;
}

/** Extract EUR compra/venta from the BNA "Billetes" table (not Divisas) on the current-quote page. */
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

/**
 * Parse the BNA historical "Billetes" result table into quotes. Each data row carries a
 * dd/mm/yyyy date followed by its compra & venta in es-AR format; we pair them per row.
 * Returns ISO-dated quotes in document order. Best-effort over the rendered table — validate
 * against the live response before production (same caveat as parseBnaEur).
 */
export function parseBnaHistoric(html: string): { date: string; compra: number; venta: number }[] {
  const rows: { date: string; compra: number; venta: number }[] = [];
  const re =
    /(\d{2})\/(\d{2})\/(\d{4})[\s\S]{0,160}?(\d{1,3}(?:\.\d{3})*,\d{2})[\s\S]{0,80}?(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let m = re.exec(html);
  while (m !== null) {
    rows.push({
      date: `${m[3]}-${m[2]}-${m[1]}`, // dd/mm/yyyy -> ISO
      compra: parseArNumber(m[4]),
      venta: parseArNumber(m[5]),
    });
    m = re.exec(html);
  }
  return rows;
}

/** Fetch + parse today's EUR quote from BNA's current-quote page. fetchImpl injectable for testing. */
export async function fetchBnaEur(fetchImpl: typeof fetch = fetch, url = BNA_URL) {
  const res = await fetchImpl(url, { headers: BNA_HEADERS });
  if (!res.ok) throw new Error(`BNA fetch failed: ${res.status}`);
  return parseBnaEur(await res.text());
}

/** Fetch BNA's current EUR quote and upsert it into the rate table for `date`. */
export async function importBnaEur(db: Db, date: string, fetchImpl: typeof fetch = fetch) {
  const { compra, venta } = await fetchBnaEur(fetchImpl);
  return upsertFxRate(db, { date, compra, venta, source: "BNA" });
}

/**
 * Query BNA's historical record for EUR "Billetes" quotes in a window ending at `date`.
 * The cotizador is an ASP.NET form: GET it for the CSRF token + WAF cookie, then POST the
 * Euro filter (filtroMoneda=12) and a dd/mm/yyyy range. Verified request shape against the
 * live endpoint; the row markup is parsed best-effort (see parseBnaHistoric).
 */
export async function fetchBnaHistoricEur(date: string, fetchImpl: typeof fetch = fetch) {
  const form = await fetchImpl(HISTORIC_URL, { headers: BNA_HEADERS });
  if (!form.ok) throw new Error(`BNA historico form: ${form.status}`);
  const cookie = form.headers.get("set-cookie") ?? "";
  const token = /__RequestVerificationToken[^>]*value="([^"]+)"/.exec(await form.text())?.[1];
  if (!token) throw new Error("BNA historico: CSRF token not found");

  const body = new URLSearchParams({
    id: "billetes",
    filtroMoneda: EURO_FILTRO_MONEDA,
    fechaDesde: isoToAr(shiftIsoDays(date, -10)), // a 10-day window catches the closest prior quote
    fechaHasta: isoToAr(date),
    __RequestVerificationToken: token,
  });
  const res = await fetchImpl(HISTORIC_URL, {
    method: "POST",
    headers: {
      ...BNA_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {}),
      Referer: HISTORIC_URL,
    },
    body,
  });
  if (!res.ok) throw new Error(`BNA historico POST: ${res.status}`);
  return parseBnaHistoric(await res.text());
}

/** Fetch the closest EUR quote on/before `date` from the historical record and store it. */
export async function importBnaEurHistoric(db: Db, date: string, fetchImpl: typeof fetch = fetch) {
  const rows = await fetchBnaHistoricEur(date, fetchImpl);
  const closest = resolveRate(date, rows); // greatest quote date on/before `date`
  if (!closest) throw new Error(`BNA historico: no EUR quote on/before ${date}`);
  // Store under the quote's real date; getFxRate's on/before fallback resolves it for the entry.
  return upsertFxRate(db, {
    date: closest.date,
    compra: closest.compra,
    venta: closest.venta,
    source: "BNA",
  });
}

/**
 * CA-89: ensure a BNA rate is available for `date` so expenses in pesos convert on the fly without
 * a manual rate. Returns true when a quote is available (already stored, or freshly retrieved).
 * Strategy: if nothing is stored on/before `date`, pull the closest historical EUR quote from BNA's
 * historical record (works for any past date); if that's unavailable and `date` is today, fall back
 * to the current-quote page. All network failures are swallowed (→ false) so entry degrades to the
 * manual-rate path rather than erroring.
 */
export async function ensureFxRate(
  db: Db,
  date: string,
  today: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (getFxRate(db, date)) return true;
  try {
    await importBnaEurHistoric(db, date, fetchImpl);
    if (getFxRate(db, date)) return true;
  } catch {
    // historical record unavailable — try the current-quote page below
  }
  if (date === today) {
    try {
      await importBnaEur(db, today, fetchImpl);
      return true;
    } catch {
      // current-quote page unavailable too
    }
  }
  return false;
}

/** ISO "YYYY-MM-DD" -> BNA's "DD/MM/YYYY". */
function isoToAr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Shift an ISO date by whole days (UTC, deterministic — input is always an explicit ISO string). */
function shiftIsoDays(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
