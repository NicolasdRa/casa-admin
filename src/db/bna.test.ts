import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureFxRate, importBnaEur, parseArNumber, parseBnaEur, parseBnaHistoric } from "./bna.ts";
import { createExpense } from "./expenses.ts";
import { getFxRate } from "./fx.ts";
import { makeTestDb } from "./testdb.ts";

test("parseArNumber handles es-AR thousands/decimal", () => {
  assert.equal(parseArNumber("1.085,50"), 1085.5);
  assert.equal(parseArNumber("999,00"), 999);
  assert.equal(parseArNumber("1.234.567,89"), 1234567.89);
});

// Two sections like the real page; parseBnaEur must pick Billetes (cash), not Divisas.
const SAMPLE = `<h2>Cotización billetes</h2><table>
<tr><td>Dolar</td><td>900,00</td><td>950,00</td></tr>
<tr><td>Euro</td><td>1.085,50</td><td>1.135,00</td></tr></table>
<h2>Cotización divisas</h2><table>
<tr><td>Euro</td><td>1.090,00</td><td>1.140,00</td></tr></table>`;

test("parseBnaEur extracts the EUR compra/venta from the Billetes table", () => {
  assert.deepEqual(parseBnaEur(SAMPLE), { compra: 1085.5, venta: 1135 }); // not the Divisas 1090/1140
});

test("parseBnaEur throws when EUR row absent", () => {
  assert.throws(() => parseBnaEur("<table><tr><td>Dolar</td><td>900,00</td></tr></table>"));
});

test("importBnaEur fetches (injected) and upserts the rate", async () => {
  const db = makeTestDb();
  const fakeFetch = async () => new Response(SAMPLE, { status: 200 });
  await importBnaEur(db, "2026-06-22", fakeFetch as typeof fetch);
  const row = getFxRate(db, "2026-06-22");
  assert.equal(row?.compra, 1085.5);
  assert.equal(row?.venta, 1135);
  assert.equal(row?.average, 1110.25); // (1085.5 + 1135) / 2
  assert.equal(row?.source, "BNA");
});

// CA-89: enter expenses in pesos and convert on the fly by retrieving the closest BNA rate.

// BNA's historical cotizador is an ASP.NET form: GET it for a CSRF token, then POST the Euro
// filter + date range. This fake mirrors that two-step flow plus the current-quote page.
const HIST_FORM = `<form><input name="__RequestVerificationToken" type="hidden" value="tok-123" /></form>`;
const HIST_ROWS = `<table><tbody>
  <tr><td>17/06/2026</td><td>1.600,00</td><td>1.680,00</td></tr>
  <tr><td>20/06/2026</td><td>1.635,00</td><td>1.715,00</td></tr>
</tbody></table>`;

function bnaFake(opts: { historico?: boolean; current?: boolean } = {}) {
  const { historico = true, current = true } = opts;
  const calls: { url: string; method: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method });
    if (u.includes("HistoricoPrincipales")) {
      if (!historico) return new Response("unavailable", { status: 503 });
      return method === "POST"
        ? new Response(HIST_ROWS, { status: 200 })
        : new Response(HIST_FORM, { status: 200 });
    }
    if (!current) return new Response("unavailable", { status: 503 });
    return new Response(SAMPLE, { status: 200 }); // current-quote page
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("parseBnaHistoric pairs each date with its compra/venta, in ISO", () => {
  assert.deepEqual(parseBnaHistoric(HIST_ROWS), [
    { date: "2026-06-17", compra: 1600, venta: 1680 },
    { date: "2026-06-20", compra: 1635, venta: 1715 },
  ]);
});

test("ensureFxRate is a no-op when a rate already exists (no fetch)", async () => {
  const db = makeTestDb();
  await importBnaEur(db, "2026-06-20", async () => new Response(SAMPLE, { status: 200 }));
  const { fetchImpl, calls } = bnaFake();
  const ok = await ensureFxRate(db, "2026-06-20", "2026-06-22", fetchImpl);
  assert.equal(ok, true);
  assert.equal(calls.length, 0); // already had a rate → never hit BNA
});

test("ensureFxRate retrieves the closest historical EUR quote so a peso expense converts", async () => {
  const db = makeTestDb();
  assert.equal(getFxRate(db, "2026-06-21"), null);
  const { fetchImpl } = bnaFake();
  const ok = await ensureFxRate(db, "2026-06-21", "2026-06-21", fetchImpl);
  assert.equal(ok, true);
  // Closest quote on/before 2026-06-21 is 2026-06-20 (avg (1635+1715)/2 = 1675), stored under its
  // real date; an ARS expense then converts with no manual rate.
  const e = createExpense(db, { date: "2026-06-21", currency: "ARS", amount: 167500 }); // 1675.00 ARS
  assert.equal(e.amountArs, 167500); // entered side preserved exactly
  assert.equal(e.amountEur, 100); // 1675 ARS / 1675 = 1.00 EUR
  assert.equal(e.fxRate, 1675);
  assert.equal(e.fxRateDate, "2026-06-20"); // the real quote date, not the entry date
  assert.equal(e.fxOverridden, false); // BNA rate, not a manual override
});

test("ensureFxRate uses the historical record for a backdated entry too", async () => {
  const db = makeTestDb();
  const { fetchImpl, calls } = bnaFake();
  const ok = await ensureFxRate(db, "2026-06-19", "2026-06-21", fetchImpl);
  assert.equal(ok, true); // closest on/before 06-19 is 06-17
  assert.equal(getFxRate(db, "2026-06-19")?.average, 1640); // (1600 + 1680) / 2
  assert.ok(calls.some((c) => c.url.includes("HistoricoPrincipales"))); // it queried the historico
});

test("ensureFxRate falls back to the current-quote page when historico is down (today)", async () => {
  const db = makeTestDb();
  const today = "2026-06-22";
  const { fetchImpl } = bnaFake({ historico: false }); // historico 503s, current page ok
  const ok = await ensureFxRate(db, today, today, fetchImpl);
  assert.equal(ok, true);
  assert.equal(getFxRate(db, today)?.average, 1110.25); // from the current-quote SAMPLE
});

test("ensureFxRate returns false (not throw) when BNA is entirely unavailable", async () => {
  const db = makeTestDb();
  const today = "2026-06-22";
  const { fetchImpl } = bnaFake({ historico: false, current: false });
  const ok = await ensureFxRate(db, today, today, fetchImpl);
  assert.equal(ok, false); // graceful — the action falls back to the manual-rate path
});
