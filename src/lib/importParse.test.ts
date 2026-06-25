import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseBookings,
  parseDate,
  parseDayMonth,
  parseEuNumber,
  parseGastos,
  parseMaintenance,
  parseMoneyCents,
} from "./importParse.ts";

// --- value parsers (the load-bearing money/date logic) ---

test("parseEuNumber: European thousands dot + decimal comma", () => {
  assert.equal(parseEuNumber("€1.636,47"), 1636.47);
  assert.equal(parseEuNumber("$1.042.779,00"), 1042779);
  assert.equal(parseEuNumber("15000"), 15000);
  assert.equal(parseEuNumber("31494,6"), 31494.6);
  assert.equal(parseEuNumber("1078,83"), 1078.83);
  assert.equal(parseEuNumber("1650"), 1650);
  assert.equal(parseEuNumber(""), null);
  assert.equal(parseEuNumber("  "), null);
});

test("parseMoneyCents: integer cents, no float drift", () => {
  assert.equal(parseMoneyCents("€1.636,47"), 163647);
  assert.equal(parseMoneyCents("15000"), 1500000);
  assert.equal(parseMoneyCents("31494,6"), 3149460);
  assert.equal(parseMoneyCents("$995,63"), 99563);
  assert.equal(parseMoneyCents("€0,00"), 0);
  assert.equal(parseMoneyCents(""), null);
});

test("parseDate: dot, single-slash and zero-padded slash forms → ISO", () => {
  assert.equal(parseDate("21.12.2023"), "2023-12-21");
  assert.equal(parseDate("6.1.2026"), "2026-01-06");
  assert.equal(parseDate("4/1/2026"), "2026-01-04");
  assert.equal(parseDate("13/07/2025"), "2025-07-13");
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("not a date"), null);
});

test("parseDayMonth: DD.MM + block year → ISO", () => {
  assert.equal(parseDayMonth("20.11", "2025"), "2025-11-20");
  assert.equal(parseDayMonth("5.12", "2023"), "2023-12-05");
  assert.equal(parseDayMonth("", "2025"), null);
});

// --- booking unpivot ---

test("parseBookings: unpivots blocks, detects type, skips empty rows", () => {
  const rows = [
    [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "",
      "2026",
      "",
      "",
      "",
      "",
      "",
      "",
      "2025",
      "",
      "",
      "",
      "",
      "",
      "",
      "2024",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "2023",
      "",
      "",
      "",
    ],
    [
      "",
      "",
      "",
      "Ingresos",
      "",
      "comisión 10%",
      "",
      "",
      "",
      "",
      "Ingresos",
      "",
      "comisión 10%",
      "",
      "",
      "",
      "Ingresos",
      "",
      "comisión 10%",
      "",
      "",
      "",
      "",
      "",
      "Ingresos",
      "",
      "comisión 10%",
    ],
    [
      "",
      "",
      "Huésped",
      "USD",
      "€",
      "€",
      "",
      "",
      "",
      "Huésped",
      "USD",
      "€",
      "€",
      "",
      "",
      "",
      "Huésped",
      "USD",
      "€",
      "€",
      "",
      "",
      "",
      "",
      "Huésped",
      "USD",
      "€",
      "€",
    ],
    [
      "1",
      "6.1.2026",
      "Mariano",
      "",
      "€462,68",
      "€46,27",
      "",
      "1",
      "1.1.2025",
      "Raúl Moreno",
      "",
      "€577,57",
      "€57,76",
      "",
      "1",
      "1.1.2024",
      "Nico Z",
      "$995,63",
      "€902,06",
      "€90,21",
      "",
      "",
      "1",
      "22.12.2022",
      "Martin F",
      "$448,40",
      "€407,22",
      "€40,72",
    ],
    [
      "7",
      "15.2.2026",
      "Cristina",
      "",
      "€510,10",
      "€51,01",
      "",
      "7",
      "1.3.2025",
      "Tomás",
      "",
      "€672,60",
      "€67,26",
      "",
      "7",
      "20.3.2024",
      "Anita - damage reinbursement",
      "$365,00",
      "€335,33",
      "€33,53",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "",
      "",
      "",
      "",
      "",
      "€0,00",
      "",
      "14",
      "26.12.2024",
      "Ana (cancelación) ",
      "",
      "€231,31",
      "€0,00",
      "",
      "14",
      "26.12.2024",
      "Ana (cancelación) ",
      "$241,07",
      "€231,31",
      "€0,00",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "",
      "",
      "Subtotales",
      "$0,00",
      "€4.279,64",
      "€427,96",
      "",
      "",
      "",
      "Subtotales",
      "$0,00",
      "€8.767,54",
      "€876,75",
      "",
      "",
      "",
      "Subtotales",
      "$9.118,40",
      "€8.423,02",
      "€819,17",
      "",
      "",
      "",
      "",
      "Subtotales",
      "$448,40",
      "€407,22",
      "€40,72",
    ],
  ];
  const { bookings, subtotals } = parseBookings(rows);
  const mariano = bookings.find((b) => b.guest === "Mariano");
  assert.equal(mariano?.amountEurCents, 46268);
  assert.equal(mariano?.year, "2026");
  assert.equal(mariano?.type, "booking");
  assert.equal(bookings.find((b) => b.guest.includes("damage"))?.type, "damage");
  assert.equal(bookings.find((b) => b.guest.includes("cancelación"))?.type, "cancellation");
  // empty 2026 row #11 (only €0,00 commission) is not a booking
  assert.equal(bookings.filter((b) => b.year === "2026").length, 2);
  assert.deepEqual(
    subtotals.find((s) => s.year === "2025"),
    { year: "2025", eurCents: 876754, commCents: 87675 },
  );
});

// --- gastos sections ---

test("parseGastos: payer by column, category group, taxes use FX-date col", () => {
  const rows = [
    ["", "2025", "Gastos operativos", "", "Nicolás", "", "Anastasia", "", "", "", "", "", "", ""],
    [
      "",
      "FECHA",
      "Proveedor",
      "detalle",
      "ARS",
      "EUR",
      "ARS",
      "EUR",
      "",
      "€ prom ",
      "compra",
      "venta",
      "",
      "",
    ],
    [
      "",
      "6.1.2025",
      "Nancy López",
      "limpieza",
      "15000",
      "13,90",
      "",
      "",
      "",
      "1078,83",
      "1044,58",
      "1113,07",
      "",
      "",
    ],
    [
      "",
      "",
      "Karina López",
      "limpieza 2",
      "12500",
      "11,59",
      "",
      "",
      "",
      "1078,83",
      "1044,58",
      "1113,07",
      "",
      "",
    ],
    [
      "",
      "Total",
      "€25,49",
      "subtotales",
      "$27.500,00",
      "€25,49",
      "$0,00",
      "€0,00",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    ["", "2025", "Servicios", "", "Nicolás", "", "Anastasia", "", "", "", "", "", "", ""],
    [
      "",
      "FECHA",
      "servicio",
      "detalle",
      "ARS",
      "EUR",
      "ARS",
      "EUR",
      "",
      "€ prom ",
      "compra",
      "venta",
      "fecha",
      "",
    ],
    [
      "Luz",
      "",
      "EDEA",
      "Período 1/25",
      "",
      "",
      "$25.920,79",
      "23,70",
      "",
      "1093,63",
      "1059,14",
      "1128,12",
      "10/02/2025",
      "",
    ],
    [
      "",
      "Total",
      "€23,70",
      "subtotales",
      "$0,00",
      "€0,00",
      "$25.920,79",
      "€23,70",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
  ];
  const { expenses, totals, fxRates } = parseGastos(rows);
  // FX back-fill: compra/venta captured per dated row (deduped downstream by the loader)
  assert.equal(fxRates[0].date, "2025-01-06");
  assert.equal(fxRates[0].compra, 1044.58);
  assert.equal(fxRates.find((r) => r.date === "2025-02-10")?.venta, 1128.12);
  assert.equal(expenses.length, 3);
  const nancy = expenses[0];
  assert.equal(nancy.group, "operating");
  assert.equal(nancy.payer, "nicolas");
  assert.equal(nancy.currency, "ARS");
  assert.equal(nancy.amountCents, 1500000);
  assert.equal(nancy.rate, 1078.83);
  assert.equal(nancy.sheetEurCents, 1390);
  // blank FECHA forward-fills within the section
  assert.equal(expenses[1].date, "2025-01-06");
  // services row: Anastasia payer, date from the FX-date column
  const edea = expenses[2];
  assert.equal(edea.payer, "anastasia");
  assert.equal(edea.group, "services");
  assert.equal(edea.date, "2025-02-10");
  assert.equal(edea.amountCents, 2592079);
  // captured section totals (per-partner EUR) for reconciliation
  assert.equal(totals.find((t) => t.group === "operating")?.nicoEurCents, 2549);
  assert.equal(totals.find((t) => t.group === "services")?.anaEurCents, 2370);
});

test("parseGastos: row with no amount is rejected, not guessed", () => {
  const rows = [
    [
      "",
      "2025",
      "Gastos mantenimiento",
      "",
      "Nicolás",
      "",
      "Anastasia",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "",
      "FECHA",
      "Proveedor",
      "detalle",
      "ARS",
      "EUR",
      "ARS",
      "EUR",
      "",
      "€ prom ",
      "compra",
      "venta",
      "",
      "",
    ],
    ["", "19.7.2025", "vaso expansión", "Marito", "", "", "", "", "", "", "", "", "", ""],
  ];
  const { expenses, rejects } = parseGastos(rows);
  assert.equal(expenses.length, 0);
  assert.equal(rejects.length, 1);
  assert.match(rejects[0].reason, /amount/i);
});

// --- maintenance ---

test("parseMaintenance: pending vs done, year attach, date forward-fill", () => {
  const rows = [
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "2025", "", "", "", "", "2024", "", "", "", "", "2023"],
    [
      "",
      "pendientes",
      "",
      "",
      "",
      "",
      "20.11",
      "hidrolavado porton",
      "",
      "",
      "",
      "23.11",
      "poda cerco",
    ],
    ["", "pintura estudio", "", "", "", "", "", "orden estudio", "", "", "", "", "poda cañas"],
    [
      "20.11",
      "Lavado almohadones",
      "",
      "",
      "",
      "",
      "21.11",
      "desarme puerta",
      "",
      "",
      "",
      "",
      "corte de pasto",
    ],
    [
      "",
      "Lavado cortinas",
      "",
      "",
      "",
      "",
      "",
      "compra materiales",
      "",
      "",
      "",
      "",
      "barrido hojas",
    ],
  ];
  const { tasks } = parseMaintenance(rows);
  const pend = tasks.find((t) => t.description === "pintura estudio");
  assert.equal(pend?.status, "pending");
  assert.equal(pend?.season, "2025");
  const dated = tasks.find((t) => t.description === "Lavado almohadones");
  assert.equal(dated?.status, "done");
  assert.equal(dated?.date, "2025-11-20");
  // forward-fill: next 2025 row with blank date inherits 20.11
  assert.equal(tasks.find((t) => t.description === "Lavado cortinas")?.date, "2025-11-20");
  // 2024 block, own date + year
  assert.equal(tasks.find((t) => t.description === "desarme puerta")?.date, "2024-11-21");
  assert.equal(tasks.find((t) => t.description === "poda cerco")?.date, "2023-11-23");
});
