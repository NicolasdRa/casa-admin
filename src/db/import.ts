// CA-11 historical import: bookings + expenses + maintenance from the workbook CSVs.
// Dry-run by default (parse + reconcile + report); `--commit` writes; `--reset` clears the fact
// tables first; `--force` loads despite reconciliation diffs; `--dir=PATH` overrides the CSV folder.
//   node src/db/import.ts                 # dry run against ./data/import
//   node src/db/import.ts --commit        # load
//   DB_PATH=/tmp/x.db node src/db/import.ts --commit --reset
// ponytail: in-memory staging, fine at ~500 rows; add staging_* tables only if this grows.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bnaAverage, resolveRate, snapshot } from "../lib/fx.ts";
import {
  type ParsedExpense,
  parseBookings,
  parseGastos,
  parseMaintenance,
} from "../lib/importParse.ts";
import { parseCsv } from "../lib/parseCsv.ts";
import { createBooking } from "./bookings.ts";
import { createExpense, listCategories } from "./expenses.ts";
import { getFxRate, upsertFxRate } from "./fx.ts";
import { db } from "./index.ts";
import { createTask } from "./maintenance.ts";
import { listPartners } from "./partners.ts";
import * as schema from "./schema.ts";
import { createSupplier } from "./suppliers.ts";
import { listUsers } from "./users.ts";

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const COMMIT = has("--commit");
const RESET = has("--reset");
const FORCE = has("--force");
const DIR = args.find((a) => a.startsWith("--dir="))?.slice(6) ?? "./data/import";
const TOL = 5; // booking income reconciliation tolerance, cents (±0.05 €)

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

// --- read CSVs ---
const files = readdirSync(DIR);
const find = (needle: string) => {
  const f = files.find((n) => n.includes(needle) && n.endsWith(".csv"));
  if (!f) throw new Error(`CSV not found in ${DIR}: *${needle}*`);
  return parseCsv(readFileSync(join(DIR, f), "utf8"));
};

const { bookings, rejects: bookingRejects, subtotals } = parseBookings(find("Alquileres"));

const YEARS = ["2023", "2024", "2025", "2026"];
const expenses: ParsedExpense[] = [];
const expenseRejects: { sourceRow: number; reason: string; raw: string[]; year: string }[] = [];
const fxRaw: { date: string; compra: number; venta: number }[] = [];
const expenseRecon: { year: string; group: string; derived: number; sheet: number }[] = [];
for (const y of YEARS) {
  const g = parseGastos(find(`Gastos ${y}`));
  expenses.push(...g.expenses);
  for (const r of g.rejects) expenseRejects.push({ ...r, year: y });
  fxRaw.push(...g.fxRates);
  // reconcile each section's derived-EUR sum against the sheet's per-partner Total
  const rates = dedupeRates(g.fxRates);
  for (const t of g.totals) {
    const derived = g.expenses
      .filter((e) => e.group === t.group)
      .reduce((s, e) => s + derivedEur(e, rates), 0);
    expenseRecon.push({ year: y, group: t.group, derived, sheet: t.nicoEurCents + t.anaEurCents });
  }
}

const { tasks } = parseMaintenance(find("Tareas"));
const rates = dedupeRates(fxRaw);

// --- reconciliation report ---
console.log(`\n=== CA-11 import ${COMMIT ? "(COMMIT)" : "(dry run)"} — source ${DIR} ===\n`);

let blocked = false;
console.log("Bookings income per year (hard gate ±0.05 €):");
for (const y of YEARS) {
  const sum = bookings.filter((b) => b.year === y).reduce((s, b) => s + b.amountEurCents, 0);
  const sheet = subtotals.find((s) => s.year === y)?.eurCents ?? 0;
  const diff = sum - sheet;
  const ok = Math.abs(diff) <= TOL;
  if (!ok) blocked = true;
  console.log(
    `  ${y}: ${bookings.filter((b) => b.year === y).length} rows  imported ${eur(sum)}  sheet ${eur(sheet)}  diff ${eur(diff)}  ${ok ? "OK" : "DIFF"}`,
  );
}

console.log("\nExpenses derived-EUR vs sheet section totals (informational, sub-cent rounding):");
for (const r of expenseRecon) {
  const diff = r.derived - r.sheet;
  console.log(
    `  ${r.year} ${r.group.padEnd(11)} imported ${eur(r.derived).padStart(11)}  sheet ${eur(r.sheet).padStart(11)}  diff ${eur(diff)}`,
  );
}

console.log(
  `\nCounts: ${bookings.length} bookings, ${expenses.length} expenses, ${tasks.length} tasks, ${rates.length} fx rates.`,
);
const allRejects = [
  ...bookingRejects.map((r) => ({ what: "booking", ...r })),
  ...expenseRejects.map((r) => ({ what: `expense ${r.year}`, ...r })),
];
if (allRejects.length) {
  console.log(`\nRejects (${allRejects.length}) — not imported:`);
  for (const r of allRejects)
    console.log(
      `  [${r.what} row ${r.sourceRow}] ${r.reason}: ${JSON.stringify(r.raw).slice(0, 90)}`,
    );
}

if (!COMMIT) {
  console.log("\nDry run only. Re-run with --commit to load.\n");
  process.exit(blocked ? 1 : 0);
}
if (blocked && !FORCE) {
  console.error(
    "\nReconciliation DIFF on booking income — refusing to commit. Use --force to override.\n",
  );
  process.exit(1);
}

// --- load ---
const partnerByName = new Map(listPartners(db).map((p) => [p.name, p.id]));
const userByPartner = new Map(
  listUsers(db)
    .filter((u) => u.partnerId != null)
    .map((u) => [u.partnerId as number, u.id]),
);
const payerUser = (payer: "nicolas" | "anastasia" | null) => {
  if (!payer) return undefined;
  const pid = partnerByName.get(payer === "nicolas" ? "Nicolás" : "Anastasia");
  return pid != null ? userByPartner.get(pid) : undefined;
};
const earliestAvg = rates[0]?.average; // rates sorted ascending → earliest historical quote

const summary = { fx: 0, bookings: 0, expenses: 0, tasks: 0, skipped: 0, failed: 0 };

db.transaction((tx) => {
  if (RESET) {
    tx.delete(schema.bookings).run();
    tx.delete(schema.expenses).run();
    tx.delete(schema.maintenanceTasks).run();
  }

  // FX back-fill first so booking/expense snapshots can resolve a rate from the table.
  for (const r of rates) {
    upsertFxRate(tx, { date: r.date, compra: r.compra, venta: r.venta });
    summary.fx++;
  }

  // categories by group (seeded by db:seed)
  const catByGroup = new Map(listCategories(tx).map((c) => [c.group, c.id]));

  // Pre-existing keys snapshotted once: a re-run skips rows already loaded, but two genuinely
  // identical source line items (same date/supplier/amount) both load on the first pass — so the
  // set is NOT grown during the loop (no intra-run collapsing that would drop real rows).
  const haveBooking = new Set(
    tx
      .select()
      .from(schema.bookings)
      .all()
      .map((b) => `${b.date}|${b.guest}|${b.amountEur}`),
  );
  const haveExpense = new Set(
    tx
      .select()
      .from(schema.expenses)
      .all()
      .map((e) => `${e.date}|${e.supplierId}|${e.amount}|${e.paidByUserId}`),
  );
  const haveTask = new Set(
    tx
      .select()
      .from(schema.maintenanceTasks)
      .all()
      .map((t) => `${t.season}|${t.date}|${t.description}`),
  );

  for (const b of bookings) {
    const key = `${b.date}|${b.guest}|${b.amountEurCents}`;
    if (haveBooking.has(key)) {
      summary.skipped++;
      continue;
    }
    try {
      const onTable = getFxRate(tx, b.date);
      createBooking(tx, {
        date: b.date,
        guest: b.guest,
        currency: "EUR",
        amount: b.amountEurCents,
        type: b.type,
        commissionRate: 0.1,
        manualRate: onTable ? undefined : earliestAvg, // no quote pre-2024 → fall back to earliest
      });
      summary.bookings++;
    } catch (e) {
      summary.failed++;
      console.error(`  booking failed [${b.date} ${b.guest}]: ${(e as Error).message}`);
    }
  }

  for (const x of expenses) {
    const supplierId = x.supplier ? createSupplier(tx, x.supplier).id : undefined;
    const paidByUserId = payerUser(x.payer);
    const key = `${x.date}|${supplierId ?? null}|${x.amountCents}|${paidByUserId ?? null}`;
    if (haveExpense.has(key)) {
      summary.skipped++;
      continue;
    }
    try {
      // Snapshot the sheet's € prom verbatim (doc §4). Falls back to the back-filled table rate
      // (snapshotForDate) only when a row carries no rate; throws there if none → caught as failed.
      createExpense(tx, {
        date: x.date,
        currency: x.currency,
        amount: x.amountCents,
        detail: x.detail || undefined,
        categoryId: catByGroup.get(x.group),
        supplierId,
        paidByUserId,
        manualRate: x.rate ?? undefined,
      });
      summary.expenses++;
    } catch (e) {
      summary.failed++;
      console.error(`  expense failed [${x.date} ${x.supplier}]: ${(e as Error).message}`);
    }
  }

  for (const t of tasks) {
    const key = `${t.season}|${t.date}|${t.description}`;
    if (haveTask.has(key)) {
      summary.skipped++;
      continue;
    }
    try {
      createTask(tx, {
        date: t.date,
        description: t.description,
        season: t.season,
        status: t.status,
      });
      summary.tasks++;
    } catch (e) {
      summary.failed++;
      console.error(
        `  task failed [${t.season} ${t.description.slice(0, 30)}]: ${(e as Error).message}`,
      );
    }
  }
});

console.log(
  `\nLoaded: ${summary.bookings} bookings, ${summary.expenses} expenses, ${summary.tasks} tasks, ${summary.fx} fx rates. Skipped ${summary.skipped} dups, ${summary.failed} failed.\n`,
);

// --- helpers ---
function dedupeRates(raw: { date: string; compra: number; venta: number }[]) {
  const byDate = new Map<
    string,
    { date: string; compra: number; venta: number; average: number }
  >();
  for (const r of raw) byDate.set(r.date, { ...r, average: bnaAverage(r.compra, r.venta) });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function derivedEur(e: ParsedExpense, rateList: { date: string; average: number }[]) {
  if (e.currency === "EUR") return e.amountCents;
  // Mirror the load: use the row's own € prom; only fall back to the table rate when absent.
  const rate = e.rate ?? resolveRate(e.date, rateList)?.average ?? rateList[0]?.average;
  return rate ? snapshot(e.amountCents, "ARS", rate).amountEur : 0;
}
