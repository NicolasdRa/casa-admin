// Pure parsers + row mappers for the historical workbook CSVs (CA-11). No DB, no IO — the loader
// (src/db/import.ts) maps these records onto suppliers/categories/users and the create* functions.
// Money is integer cents; the entered side is preserved exactly (see lib/fx.ts). Sheet figures use
// European formatting ($/€ prefix, "." thousands, "," decimal) and three date forms.

export type Group = "operating" | "equipment" | "maintenance" | "taxes" | "services";
export type Payer = "nicolas" | "anastasia";

/** Section header label (col C) → category group. Covers both "Impuestos" and "Impuestos & tasas". */
export const EXPENSE_GROUPS: Record<string, Group> = {
  "Gastos operativos": "operating",
  "Gastos equipamiento": "equipment",
  "Gastos mantenimiento": "maintenance",
  Impuestos: "taxes",
  "Impuestos & tasas": "taxes",
  Servicios: "services",
};

const pad = (n: number) => String(n).padStart(2, "0");

// Case-insensitive group lookup — the sheets are inconsistent ("Gastos mantenimiento" vs
// "Gastos Mantenimiento"), and a missed header silently mis-buckets a whole section.
const GROUP_BY_LOWER = new Map(
  Object.entries(EXPENSE_GROUPS).map(([k, v]) => [k.toLowerCase(), v]),
);
export const groupFor = (label: string): Group | null =>
  GROUP_BY_LOWER.get((label ?? "").trim().toLowerCase()) ?? null;

/** European number: strip €/$ and spaces, drop "." thousands, treat "," as decimal. Blank → null. */
export function parseEuNumber(s: string): number | null {
  const cleaned = (s ?? "").replace(/[€$\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned.replace(/\./g, "").replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

/** Integer cents from a sheet money cell. Blank → null. */
export function parseMoneyCents(s: string): number | null {
  const n = parseEuNumber(s);
  return n === null ? null : Math.round(n * 100);
}

/** "DD.MM.YYYY" | "D/M/YYYY" | "DD/MM/YYYY" → ISO. Day-first always. Unparseable → null. */
export function parseDate(s: string): string | null {
  const parts = (s ?? "").trim().split(/[./]/);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y || m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "DD.MM" (no year) + block year → ISO. Used by the maintenance sheet. Blank → null. */
export function parseDayMonth(s: string, year: string): string | null {
  const parts = (s ?? "").trim().split(".");
  if (parts.length < 2) return null;
  const [d, m] = parts.map(Number);
  if (!d || !m || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${pad(m)}-${pad(d)}`;
}

const lc = (s: string) => (s ?? "").toLowerCase();

export interface ParsedBooking {
  year: string;
  date: string;
  guest: string;
  amountEurCents: number;
  type: "booking" | "cancellation" | "damage";
  sheetCommissionCents: number | null;
  sourceRow: number;
}
export interface ParsedExpense {
  date: string;
  group: Group;
  supplier: string;
  detail: string;
  currency: "ARS" | "EUR";
  amountCents: number;
  rate: number | null;
  payer: Payer | null;
  sheetEurCents: number | null;
  sourceRow: number;
}
export interface ParsedTask {
  date: string;
  description: string;
  season: string;
  status: "pending" | "done";
  sourceRow: number;
}
export interface Reject {
  sourceRow: number;
  reason: string;
  raw: string[];
}

function bookingType(guest: string): ParsedBooking["type"] {
  const g = lc(guest);
  if (g.includes("cancelaci")) return "cancellation";
  // Legacy sheets labelled guest-paid damage as "damage reinbursement/reembolso" — all are the
  // damage type now (the "reimbursement" wording belonged to the co-host expense flow, not bookings).
  if (
    g.includes("damage") ||
    g.includes("daño") ||
    g.includes("reinbursement") ||
    g.includes("reimbursement") ||
    g.includes("reembolso")
  )
    return "damage";
  return "booking";
}

// Fixed column offsets per side-by-side year block (date, guest, €, commission). Spacing between
// blocks is irregular in the export, so these are pinned to observed positions, not computed.
const BOOKING_BLOCKS = [
  { year: "2026", d: 1, g: 2, e: 4, c: 5 },
  { year: "2025", d: 8, g: 9, e: 11, c: 12 },
  { year: "2024", d: 15, g: 16, e: 18, c: 19 },
  { year: "2023", d: 23, g: 24, e: 26, c: 27 },
];

export function parseBookings(rows: string[][]): {
  bookings: ParsedBooking[];
  rejects: Reject[];
  subtotals: { year: string; eurCents: number; commCents: number }[];
} {
  const bookings: ParsedBooking[] = [];
  const rejects: Reject[] = [];
  const subtotals: { year: string; eurCents: number; commCents: number }[] = [];

  const done = new Set<string>(); // block.year once its Subtotales row is passed — ignore the summary below
  rows.forEach((row, i) => {
    for (const b of BOOKING_BLOCKS) {
      if (done.has(b.year)) continue;
      const guest = (row[b.g] ?? "").trim();
      if (!guest || guest === "Huésped") continue;
      if (guest === "Subtotales") {
        subtotals.push({
          year: b.year,
          eurCents: parseMoneyCents(row[b.e]) ?? 0,
          commCents: parseMoneyCents(row[b.c]) ?? 0,
        });
        done.add(b.year);
        continue;
      }
      const amountEurCents = parseMoneyCents(row[b.e]);
      const date = parseDate(row[b.d]);
      if (amountEurCents === null || date === null) {
        rejects.push({ sourceRow: i, reason: "booking missing amount or date", raw: row });
        continue;
      }
      bookings.push({
        year: b.year,
        date,
        guest,
        amountEurCents,
        type: bookingType(guest),
        sheetCommissionCents: parseMoneyCents(row[b.c]),
        sourceRow: i,
      });
    }
  });
  return { bookings, rejects, subtotals };
}

// Gastos columns (0-based): 1 FECHA, 2 supplier, 3 detail, 4/5 Nicolás ARS/EUR, 6/7 Anastasia ARS/EUR,
// 9/10/11 € prom / compra / venta, 12 FX date (only populated in Impuestos & Servicios).
export function parseGastos(rows: string[][]): {
  expenses: ParsedExpense[];
  rejects: Reject[];
  totals: { group: Group; nicoEurCents: number; anaEurCents: number }[];
  fxRates: { date: string; compra: number; venta: number }[];
} {
  const expenses: ParsedExpense[] = [];
  const rejects: Reject[] = [];
  const totals: { group: Group; nicoEurCents: number; anaEurCents: number }[] = [];
  const fxRates: { date: string; compra: number; venta: number }[] = [];
  let group: Group | null = null;
  let lastDate: string | null = null;

  rows.forEach((row, i) => {
    const c1 = (row[1] ?? "").trim();
    const c2 = (row[2] ?? "").trim();
    const headerGroup = /^\d{4}$/.test(c1) ? groupFor(c2) : null;
    if (headerGroup) {
      group = headerGroup;
      lastDate = null;
      return;
    }
    if (c1 === "FECHA") return; // column-header row
    if (c1.startsWith("Total")) {
      if (group)
        totals.push({
          group,
          nicoEurCents: parseMoneyCents(row[5]) ?? 0,
          anaEurCents: parseMoneyCents(row[7]) ?? 0,
        });
      return;
    }
    if ((row[3] ?? "").trim() === "Total Gastos por socio") return; // grand total, recompute
    if (!group) return;

    const nicoArs = parseMoneyCents(row[4]);
    const nicoEur = parseMoneyCents(row[5]);
    const anaArs = parseMoneyCents(row[6]);
    const anaEur = parseMoneyCents(row[7]);
    let payer: Payer | null = null;
    let arsCents: number | null = null;
    let eurCents: number | null = null;
    if (nicoArs !== null || nicoEur !== null) {
      payer = "nicolas";
      arsCents = nicoArs;
      eurCents = nicoEur;
    } else if (anaArs !== null || anaEur !== null) {
      payer = "anastasia";
      arsCents = anaArs;
      eurCents = anaEur;
    }
    const hasContent = (row[2] ?? "").trim() || (row[3] ?? "").trim() || payer;
    if (!hasContent) return; // blank separator row
    if (payer === null || (arsCents === null && eurCents === null)) {
      rejects.push({ sourceRow: i, reason: "expense has no amount", raw: row });
      return;
    }

    const date = parseDate(row[1]) ?? parseDate(row[12]) ?? lastDate;
    if (date === null) {
      rejects.push({ sourceRow: i, reason: "expense has no resolvable date", raw: row });
      return;
    }
    lastDate = date;

    const compra = parseEuNumber(row[10]);
    const venta = parseEuNumber(row[11]);
    if (compra !== null && venta !== null) fxRates.push({ date, compra, venta });

    const currency = arsCents !== null ? "ARS" : "EUR";
    expenses.push({
      date,
      group,
      supplier: (row[2] ?? "").trim(),
      detail: (row[3] ?? "").trim(),
      currency,
      amountCents: (currency === "ARS" ? arsCents : eurCents) as number,
      rate: parseEuNumber(row[9]),
      payer,
      sheetEurCents: eurCents,
      sourceRow: i,
    });
  });
  return { expenses, rejects, totals, fxRates };
}

// Maintenance: three side-by-side blocks at fixed (date, description) columns, years read left-to-right
// from the header row. The 2025 block opens with a "pendientes" (undated, status=pending) sub-list.
const TASK_BLOCKS = [
  { d: 0, t: 1 },
  { d: 6, t: 7 },
  { d: 11, t: 12 },
];

export function parseMaintenance(rows: string[][]): { tasks: ParsedTask[]; rejects: Reject[] } {
  const tasks: ParsedTask[] = [];
  const rejects: Reject[] = [];

  const headerIdx = rows.findIndex((r) => r.some((c) => /^\d{4}$/.test((c ?? "").trim())));
  if (headerIdx === -1) return { tasks, rejects };
  const years = rows[headerIdx]
    .filter((c) => /^\d{4}$/.test((c ?? "").trim()))
    .map((c) => c.trim());

  const state = TASK_BLOCKS.map((b, i) => ({
    ...b,
    year: years[i],
    lastDate: null as string | null,
    pending: false,
  }));

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    for (const blk of state) {
      if (!blk.year) continue;
      const desc = (row[blk.t] ?? "").trim();
      if (!desc) continue;
      if (lc(desc) === "pendientes") {
        blk.pending = true; // label row, not a task
        continue;
      }
      const dated = parseDayMonth(row[blk.d], blk.year);
      if (dated) {
        blk.lastDate = dated;
        blk.pending = false;
      }
      const date = dated ?? blk.lastDate ?? `${blk.year}-11-01`; // ponytail: placeholder for undated pre-season tasks; date is NOT NULL
      tasks.push({
        date,
        description: desc,
        season: blk.year,
        status: blk.pending ? "pending" : "done",
        sourceRow: i,
      });
    }
  }
  return { tasks, rejects };
}
