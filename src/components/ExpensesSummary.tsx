import { createAsync, query } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import { PieBreakdown } from "~/components/PieBreakdown";
import { listCategories, listExpensesWithPayer } from "~/db/expenses";
import { db } from "~/db/index";
import { listSuppliers } from "~/db/suppliers";
import { breakdown, totalEur } from "~/lib/expenseSummary";
import { useI18n } from "~/lib/i18n";
import { formatMoney } from "~/lib/money";
import { requireUser } from "~/lib/session";

export type ExpenseRow = ReturnType<typeof listExpensesWithPayer>[number];

// Shared queries — the expenses page imports these too, so both routes hit one cached source.
export const listExpensesQuery = query(async () => {
  "use server";
  await requireUser();
  return listExpensesWithPayer(db);
}, "expenses");

export const listSuppliersQuery = query(async () => {
  "use server";
  await requireUser();
  return listSuppliers(db);
}, "suppliers");

export const listCategoriesQuery = query(async () => {
  "use server";
  await requireUser();
  return listCategories(db);
}, "categories");

const TOP_N = 6; // supplier/category cap before the tail rolls into "Other"; payer is uncapped.

/**
 * CA-119: gross EUR summary card — grand total + (when filtered) a filtered total, plus three
 * collapsed-by-default pies (supplier / payer / category). Self-loads its data so it can sit on
 * both the expenses page and the panel. `filtered` is the host's visible set: when present the
 * charts + the filtered total track it; absent (panel) the charts segment the whole ledger.
 */
export function ExpensesSummary(props: { filtered?: ExpenseRow[]; title?: string }) {
  const { t, locale } = useI18n();
  const all = createAsync(() => listExpensesQuery(), { initialValue: [] });
  const suppliers = createAsync(() => listSuppliersQuery(), { initialValue: [] });
  const categories = createAsync(() => listCategoriesQuery(), { initialValue: [] });
  const money = (c: number) => formatMoney(c, locale());

  const supplierNameById = createMemo(() => new Map(suppliers().map((s) => [s.id, s.name])));
  const categoryNameById = createMemo(() => new Map(categories().map((c) => [c.id, c.name])));
  const unassigned = () => t("expenses.unassigned");

  const charted = () => props.filtered ?? all();
  const grandTotal = createMemo(() => totalEur(all()));
  const filteredTotal = createMemo(() => totalEur(charted()));
  // Show the second figure only when a filter actually narrows the set (equal totals ⇒ unfiltered).
  const showFiltered = () => props.filtered != null && filteredTotal() !== grandTotal();

  const supplierBreakdown = createMemo(() =>
    breakdown(
      charted(),
      (e) => (e.supplierId == null ? "" : String(e.supplierId)),
      (e) =>
        e.supplierId == null
          ? unassigned()
          : (supplierNameById().get(e.supplierId) ?? unassigned()),
      TOP_N,
      t("expenses.other"),
    ),
  );
  const categoryBreakdown = createMemo(() =>
    breakdown(
      charted(),
      (e) => (e.categoryId == null ? "" : String(e.categoryId)),
      (e) =>
        e.categoryId == null
          ? unassigned()
          : (categoryNameById().get(e.categoryId) ?? unassigned()),
      TOP_N,
      t("expenses.other"),
    ),
  );
  const payerBreakdown = createMemo(() =>
    breakdown(
      charted(),
      (e) => (e.payerUserId == null ? "" : String(e.payerUserId)),
      (e) => e.payerName ?? unassigned(),
    ),
  );

  return (
    <Show when={all().length > 0}>
      <section class="panel summary-card">
        <Show when={props.title}>
          <div class="panel-head">
            <h2>{props.title}</h2>
          </div>
        </Show>
        <dl class="summary-totals">
          <div>
            <dt>{t("expenses.total")}</dt>
            <dd class="num">{money(grandTotal())} EUR</dd>
          </div>
          <Show when={showFiltered()}>
            <div>
              <dt>{t("expenses.filteredTotal")}</dt>
              <dd class="num">{money(filteredTotal())} EUR</dd>
            </div>
          </Show>
        </dl>
        {/* Graphs collapsed by default — native <details>, no JS. */}
        <details class="summary-graphs">
          <summary>{t("expenses.showGraphs")}</summary>
          <div class="summary-charts">
            <PieBreakdown
              title={t("expenses.bySupplier")}
              data={supplierBreakdown()}
              money={money}
            />
            <PieBreakdown title={t("expenses.byPayer")} data={payerBreakdown()} money={money} />
            <PieBreakdown
              title={t("expenses.byCategory")}
              data={categoryBreakdown()}
              money={money}
            />
          </div>
        </details>
      </section>
    </Show>
  );
}
