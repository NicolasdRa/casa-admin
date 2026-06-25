import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { accruedCommissionEur, listBookings, rentalIncomeEur } from "./bookings.ts";
import { listCashLedger } from "./cash.ts";
import { listCategories, listExpenses } from "./expenses.ts";
import { listTasks } from "./maintenance.ts";
import type * as schema from "./schema.ts";
import { ownerSettlement } from "./settlement.ts";

type Db = BetterSQLite3Database<typeof schema>;

const year = (iso: string) => iso.slice(0, 4);
const month = (iso: string) => iso.slice(0, 7);

export interface AnnualPnl {
  year: string;
  income: number; // rental income (type=booking), EUR cents
  commission: number; // co-host commission, EUR cents
  expensesByGroup: { group: string; eur: number }[];
  totalExpenses: number;
  netResult: number; // income - commission - totalExpenses
}

/** RP-1: annual P&L. Expenses grouped by category group (operating/equipment/maintenance/taxes/services). */
export function annualPnl(db: Db, y: string): AnnualPnl {
  const groupOf = new Map(listCategories(db).map((c) => [c.id, c.group]));
  const bookings = listBookings(db).filter((b) => year(b.date) === y);
  // Income is gross of every booking row — cancellation fees and damage reimbursements are real
  // money in (legacy-sheet parity); only `booking` rows carry commission (BK-5), summed verbatim.
  const income = bookings.reduce((s, b) => s + b.amountEur, 0);
  const commission = bookings.reduce((s, b) => s + b.commissionEur, 0);

  const byGroup = new Map<string, number>();
  let totalExpenses = 0;
  for (const e of listExpenses(db).filter((e) => year(e.date) === y)) {
    const g = (e.categoryId && groupOf.get(e.categoryId)) || "uncategorized";
    byGroup.set(g, (byGroup.get(g) ?? 0) + e.amountEur);
    totalExpenses += e.amountEur;
  }
  return {
    year: y,
    income,
    commission,
    expensesByGroup: [...byGroup]
      .map(([group, eur]) => ({ group, eur }))
      .sort((a, b) => b.eur - a.eur),
    totalExpenses,
    netResult: income - commission - totalExpenses,
  };
}

/** Distinct years present across bookings + expenses, ascending. */
export function reportYears(db: Db): string[] {
  const ys = new Set<string>();
  for (const b of listBookings(db)) ys.add(year(b.date));
  for (const e of listExpenses(db)) ys.add(year(e.date));
  return [...ys].sort();
}

/** RP-2: consolidated balance per year from `fromYear`, with a running cumulative net.
 *  Defaults to the earliest year present — a hardcoded floor would silently drop pre-season
 *  bookings (e.g. a late-December check-in lands in the prior calendar year) from the totals. */
export function multiYearBalance(db: Db, fromYear?: string) {
  const all = reportYears(db);
  const from = fromYear ?? all[0] ?? "2023";
  const years = all.filter((y) => y >= from);
  let cumulative = 0;
  return years.map((y) => {
    const p = annualPnl(db, y);
    cumulative += p.netResult;
    return {
      year: y,
      income: p.income,
      expenses: p.totalExpenses,
      commission: p.commission,
      net: p.netResult,
      cumulative,
    };
  });
}

/** RP-3: unified bi-monetary ledger (ARS + EUR + FX rate + FX date) across bookings & expenses. */
export function biMonetaryEntries(db: Db) {
  const rows = [
    ...listBookings(db).map((b) => ({
      date: b.date,
      kind: "booking" as const,
      detail: b.guest,
      ars: b.amountArs,
      eur: b.amountEur,
      fxRate: b.fxRate,
      fxRateDate: b.fxRateDate,
    })),
    ...listExpenses(db).map((e) => ({
      date: e.date,
      kind: "expense" as const,
      detail: e.detail ?? "",
      ars: e.amountArs,
      eur: e.amountEur,
      fxRate: e.fxRate,
      fxRateDate: e.fxRateDate,
    })),
  ];
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/** RP-6: income vs expense per month (EUR cents), ascending by month. */
export function incomeVsExpenseByMonth(db: Db) {
  const acc = new Map<string, { income: number; expense: number }>();
  const bump = (m: string, k: "income" | "expense", v: number) => {
    const cur = acc.get(m) ?? { income: 0, expense: 0 };
    cur[k] += v;
    acc.set(m, cur);
  };
  for (const b of listBookings(db)) bump(month(b.date), "income", b.amountEur);
  for (const e of listExpenses(db)) bump(month(e.date), "expense", e.amountEur);
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, v]) => ({ month: m, ...v }));
}

/** RP-4: headline figures for the dashboard. */
export function dashboardSummary(db: Db) {
  const income = rentalIncomeEur(db);
  const expenses = listExpenses(db).reduce((s, e) => s + e.amountEur, 0);
  const commission = accruedCommissionEur(db);
  return { income, expenses, commission, netResult: income - commission - expenses };
}

export type Period = "month" | "year" | "all";

interface PnlWindow {
  income: number; // EUR cents
  commission: number; // EUR cents
  expenses: number; // EUR cents
  netResult: number; // income - commission - expenses
}

export interface PeriodSummary extends PnlWindow {
  period: Period;
  prev: PnlWindow | null; // prior comparable period; null for "all"
}

const prevMonthKey = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

// Sum income/commission/expenses over the rows whose date matches `inWindow`. Same shape as
// annualPnl's core, but window-agnostic so month/year/all share one path.
function pnlWindow(db: Db, inWindow: (date: string) => boolean): PnlWindow {
  const bookings = listBookings(db).filter((b) => inWindow(b.date));
  const income = bookings.reduce((s, b) => s + b.amountEur, 0);
  const commission = bookings.reduce((s, b) => s + b.commissionEur, 0);
  const expenses = listExpenses(db)
    .filter((e) => inWindow(e.date))
    .reduce((s, e) => s + e.amountEur, 0);
  return { income, commission, expenses, netResult: income - commission - expenses };
}

/** CA-119 panel: dashboard figures scoped to a period (month/year/all) with a prior-period
 *  comparison for deltas. `today` is an ISO date passed by the caller so the result is pinned
 *  and testable (dates are lexical YYYY-MM-DD, no Date objects in storage). */
export function periodSummary(db: Db, period: Period, today: string): PeriodSummary {
  if (period === "all") return { period, ...pnlWindow(db, () => true), prev: null };
  const sliceOf = (d: string) => (period === "year" ? d.slice(0, 4) : d.slice(0, 7));
  const curKey = sliceOf(today);
  const prevKey = period === "year" ? String(Number(curKey) - 1) : prevMonthKey(curKey);
  return {
    period,
    ...pnlWindow(db, (d) => sliceOf(d) === curKey),
    prev: pnlWindow(db, (d) => sliceOf(d) === prevKey),
  };
}

export interface DashboardAttention {
  maintenanceOpen: number; // pending maintenance tasks
  cajaBalance: number; // current caja running balance, EUR cents
  upcomingCheckIns: number; // bookings checking in within the next 7 days (inclusive)
  settlementDue: number; // EUR cents that must change hands to square owners (Σ positive expenseNet)
}

// ISO date + n days, UTC-anchored so it stays lexical and TZ-free.
const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** CA-119 panel: "needs attention" signals — leading, operational, period-independent. */
export function dashboardAttention(db: Db, today: string): DashboardAttention {
  const ledger = listCashLedger(db);
  const window = addDays(today, 7);
  return {
    maintenanceOpen: listTasks(db, { status: "pending" }).length,
    cajaBalance: ledger.length ? ledger[ledger.length - 1].runningBalance : 0,
    upcomingCheckIns: listBookings(db).filter(
      (b) => b.type === "booking" && b.date >= today && b.date <= window,
    ).length,
    settlementDue: ownerSettlement(db).owners.reduce((s, o) => s + Math.max(0, o.expenseNet), 0),
  };
}
