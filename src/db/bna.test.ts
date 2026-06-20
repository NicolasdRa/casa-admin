import assert from "node:assert/strict";
import { test } from "node:test";
import { importBnaEur, parseArNumber, parseBnaEur } from "./bna.ts";
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
