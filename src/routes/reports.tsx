import { createAsync, query, useSearchParams } from "@solidjs/router";
import { createMemo, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { FxTrend } from "~/components/FxTrend";
import { commissionBalance } from "~/db/commission";
import { db } from "~/db/index";
import {
  annualPnl,
  biMonetaryEntries,
  dashboardSummary,
  incomeVsExpenseByMonth,
  multiYearBalance,
  reportYears,
} from "~/db/reports";
import { useI18n } from "~/lib/i18n";
import { formatMoney } from "~/lib/money";
import { requireUser } from "~/lib/session";

const reportsQuery = query(async (y: string) => {
  "use server";
  const me = await requireUser();
  const isCohost = me.role === "user"; // RP-4: co-host hides net results
  const years = reportYears(db);
  const year = y || years[years.length - 1] || String(new Date().getUTCFullYear());
  return {
    canSeeNet: !isCohost,
    year,
    years,
    dashboard: dashboardSummary(db),
    pnl: annualPnl(db, year),
    balance: isCohost ? [] : multiYearBalance(db),
    commission: isCohost ? null : commissionBalance(db),
    monthly: incomeVsExpenseByMonth(db),
  };
}, "reports");

// RP-3 ledger is paged so older movements stay reachable instead of being silently cut at 100.
const ENTRIES_PAGE = 100;
const entriesQuery = query(async (page: number) => {
  "use server";
  await requireUser();
  const all = biMonetaryEntries(db);
  return {
    rows: all.slice(page * ENTRIES_PAGE, page * ENTRIES_PAGE + ENTRIES_PAGE),
    hasMore: all.length > (page + 1) * ENTRIES_PAGE,
  };
}, "reportEntries");

export default function Reports() {
  const { t, locale } = useI18n();
  const [params] = useSearchParams();
  const data = createAsync(() => reportsQuery(typeof params.year === "string" ? params.year : ""), {
    initialValue: null,
  });
  const ep = () => Math.max(0, Number(params.ep) || 0);
  const entries = createAsync(() => entriesQuery(ep()), {
    initialValue: { rows: [], hasMore: false },
  });
  // Preserve the selected year when paging the ledger; a year change resets the page (form omits ep).
  const epHref = (p: number) => {
    const q = new URLSearchParams();
    if (typeof params.year === "string" && params.year) q.set("year", params.year);
    if (p > 0) q.set("ep", String(p));
    const s = q.toString();
    return s ? `?${s}` : "?";
  };
  const money = (c: number) => formatMoney(c, locale());
  // Chart scale: longest income/expense bar across months.
  const maxMonth = createMemo(() => {
    const m = data()?.monthly ?? [];
    return Math.max(1, ...m.map((x) => Math.max(x.income, x.expense)));
  });
  const bar = (v: number, color: string) => (
    <div class="bar" style={{ background: color, width: `${(v / maxMonth()) * 100}%` }} />
  );

  return (
    <AppShell>
      <Show when={data()}>
        {(d) => (
          <>
            <header class="page-head">
              <div>
                <h1>{t("nav.reports")}</h1>
              </div>
              <div class="page-head-actions">
                <a href="/api/export?report=entries">{t("reports.exportCsv")} (CSV)</a>
                <Show when={d().canSeeNet}>
                  <a href={`/api/export?report=pnl&year=${d().year}`}>P&amp;L (CSV)</a>
                  <a href="/api/export?report=balance">{t("reports.balance")} (CSV)</a>
                </Show>
                <button type="button" class="btn-ghost" onClick={() => window.print()}>
                  {t("reports.print")}
                </button>
              </div>
            </header>

            {/* RP-4 headline figures */}
            <section class="panel stats">
              <Figure label={t("reports.income")} value={money(d().dashboard.income)} />
              <Figure label={t("reports.expenses")} value={money(d().dashboard.expenses)} />
              <Figure label={t("reports.commission")} value={money(d().dashboard.commission)} />
              <Show when={d().canSeeNet}>
                <Figure label={t("reports.net")} value={money(d().dashboard.netResult)} />
              </Show>
            </section>

            {/* RP-1 annual P&L */}
            <section class="panel">
              <div
                class="panel-head"
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                  gap: "12px",
                }}
              >
                <h2>{t("reports.pnl")}</h2>
                <form method="get">
                  <select name="year" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
                    <For each={d().years}>
                      {(y) => (
                        <option value={y} selected={y === d().year}>
                          {y}
                        </option>
                      )}
                    </For>
                  </select>
                </form>
              </div>
              <table>
                <tbody>
                  <tr>
                    <td>{t("reports.income")}</td>
                    <td class="num">{money(d().pnl.income)}</td>
                  </tr>
                  <tr>
                    <td>{t("reports.commission")}</td>
                    <td class="num">{money(d().pnl.commission)}</td>
                  </tr>
                  <For each={d().pnl.expensesByGroup}>
                    {(g) => (
                      <tr>
                        <td>{t(`categories.g_${g.group}` as Parameters<typeof t>[0]) as string}</td>
                        <td class="num">{money(g.eur)}</td>
                      </tr>
                    )}
                  </For>
                  <tr>
                    <td>{t("reports.totalExpenses")}</td>
                    <td class="num">{money(d().pnl.totalExpenses)}</td>
                  </tr>
                  <Show when={d().canSeeNet}>
                    <tr class="total">
                      <td>{t("reports.net")}</td>
                      <td class={d().pnl.netResult < 0 ? "num neg" : "num pos"}>
                        {money(d().pnl.netResult)}
                      </td>
                    </tr>
                  </Show>
                </tbody>
              </table>
            </section>

            {/* RP-2 multi-year balance */}
            <Show when={d().canSeeNet && d().balance.length > 0}>
              <section class="panel">
                <div class="panel-head">
                  <h2>{t("reports.balance")}</h2>
                </div>
                <div class="table-scroll">
                  <table class="cards">
                    <thead>
                      <tr>
                        <th>{t("bookings.year")}</th>
                        <th class="num">{t("reports.income")}</th>
                        <th class="num">{t("reports.expenses")}</th>
                        <th class="num">{t("reports.commission")}</th>
                        <th class="num">{t("reports.net")}</th>
                        <th class="num">{t("reports.cumulative")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={d().balance}>
                        {(b) => (
                          <tr>
                            <td>{b.year}</td>
                            <td class="num" data-label={t("reports.income")}>
                              {money(b.income)}
                            </td>
                            <td class="num" data-label={t("reports.expenses")}>
                              {money(b.expenses)}
                            </td>
                            <td class="num" data-label={t("reports.commission")}>
                              {money(b.commission)}
                            </td>
                            <td
                              class={b.net < 0 ? "num neg" : "num pos"}
                              data-label={t("reports.net")}
                            >
                              {money(b.net)}
                            </td>
                            <td
                              class={b.cumulative < 0 ? "num neg" : "num"}
                              data-label={t("reports.cumulative")}
                            >
                              {money(b.cumulative)}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </section>
            </Show>

            {/* RP-7 commission balance */}
            <Show when={d().commission}>
              {(c) => (
                <p class="note">
                  {t("reports.commissionBalance")}: {t("reports.accrued")} {money(c().accrued)} ·{" "}
                  {t("reports.settled")} {money(c().settled)} ·{" "}
                  <b style={{ color: "var(--ink)" }}>
                    {t("reports.owed")} {money(c().owed)}
                  </b>
                </p>
              )}
            </Show>

            {/* RP-6 charts */}
            <section class="panel panel-pad">
              <h2 style={{ "margin-bottom": "12px" }}>{t("reports.charts")}</h2>
              <For each={d().monthly}>
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
              <div style={{ "margin-top": "16px" }}>
                <FxTrend />
              </div>
            </section>

            {/* RP-3 bi-monetary ledger */}
            <section class="panel">
              <div class="panel-head">
                <h2>{t("reports.entries")}</h2>
              </div>
              <div class="table-scroll">
                <table class="cards">
                  <thead>
                    <tr>
                      <th>{t("common.date")}</th>
                      <th>{t("expenses.detail")}</th>
                      <th class="num">ARS</th>
                      <th class="num">EUR</th>
                      <th class="num">{t("common.rate")}</th>
                      <th>{t("common.rateDate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For
                      each={entries().rows}
                      fallback={
                        <tr>
                          <td colspan="6" class="note">
                            {t("reports.noEntries")}
                          </td>
                        </tr>
                      }
                    >
                      {(e) => (
                        <tr>
                          <td>{e.date}</td>
                          <td data-label={t("expenses.detail")}>
                            <span class={e.kind === "booking" ? "chip chip-pos" : "chip chip-neg"}>
                              {e.kind === "booking" ? t("nav.bookings") : t("nav.expenses")}
                            </span>{" "}
                            {e.detail}
                          </td>
                          <td class="num" data-label="ARS">
                            {money(e.ars)}
                          </td>
                          <td class="num" data-label="EUR">
                            {money(e.eur)}
                          </td>
                          <td class="num" data-label={t("common.rate")}>
                            {e.fxRate}
                          </td>
                          <td data-label={t("common.rateDate")}>{e.fxRateDate}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <Show when={ep() > 0 || entries().hasMore}>
                <nav
                  class="page-head-actions"
                  style={{ "justify-content": "flex-end", padding: "12px 16px" }}
                >
                  <Show when={ep() > 0}>
                    <a class="btn-ghost" href={epHref(ep() - 1)}>
                      ← {t("audit.prev")}
                    </a>
                  </Show>
                  <Show when={entries().hasMore}>
                    <a class="btn-ghost" href={epHref(ep() + 1)}>
                      {t("audit.next")} →
                    </a>
                  </Show>
                </nav>
              </Show>
            </section>
          </>
        )}
      </Show>
    </AppShell>
  );
}

function Figure(props: { label: string; value: string }) {
  return (
    <div class="stat">
      <div class="k">{props.label}</div>
      <div class="v">{props.value} €</div>
    </div>
  );
}
