import { createAsync, query } from "@solidjs/router";
import { createMemo, For, Show } from "solid-js";
import { db } from "~/db/index";
import { incomeVsExpenseByMonth } from "~/db/reports";
import { useI18n } from "~/lib/i18n";
import { formatMoney } from "~/lib/money";
import { requireUser } from "~/lib/session";

export type MonthRow = ReturnType<typeof incomeVsExpenseByMonth>[number];

// Shared source — /reports passes its own composite `data`; the panel self-loads via this query.
export const monthlyQuery = query(async () => {
  "use server";
  await requireUser();
  return incomeVsExpenseByMonth(db);
}, "incomeVsExpenseByMonth");

/**
 * RP-6 income-vs-expense bars, extracted from /reports so the panel reuses it (one definition,
 * two call sites — no pasted JSX). `data` lets the host pass its already-loaded set (/reports);
 * absent, it self-loads. `months` trims to the most-recent N (the panel shows a recent window).
 */
export function IncomeExpenseChart(props: { data?: MonthRow[]; months?: number }) {
  const { t, locale } = useI18n();
  const loaded = createAsync(() => monthlyQuery(), { initialValue: [] });
  const money = (c: number) => formatMoney(c, locale());

  const rows = createMemo(() => {
    const all = props.data ?? loaded();
    return props.months ? all.slice(-props.months) : all;
  });
  const max = createMemo(() => Math.max(1, ...rows().map((x) => Math.max(x.income, x.expense))));
  const bar = (v: number, color: string) => (
    <div class="bar" style={{ background: color, width: `${(v / max()) * 100}%` }} />
  );

  return (
    <Show when={rows().length > 0}>
      <For each={rows()}>
        {(m) => (
          <div class="chart-row">
            <span class="m">{m.month}</span>
            <div>
              {bar(m.income, "var(--pos)")}
              {bar(m.expense, "var(--neg)")}
            </div>
            <div class="chart-vals num">
              <span style={{ color: "var(--pos)" }}>{money(m.income)}</span>
              <span style={{ color: "var(--neg)" }}>{money(m.expense)}</span>
            </div>
          </div>
        )}
      </For>
      <p class="legend">
        <span>
          <span class="swatch" style={{ background: "var(--pos)" }} />
          {t("reports.income")}
        </span>
        <span>
          <span class="swatch" style={{ background: "var(--neg)" }} />
          {t("reports.expenses")}
        </span>
      </p>
    </Show>
  );
}
