import { createAsync, query, useSearchParams } from "@solidjs/router";
import { createMemo, For, Show } from "solid-js";
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
import { fromCents } from "~/lib/money";
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
    entries: biMonetaryEntries(db).slice(0, 100),
  };
}, "reports");

export default function Reports() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const data = createAsync(() => reportsQuery(typeof params.year === "string" ? params.year : ""), {
    initialValue: null,
  });
  const money = (c: number) => fromCents(c).toFixed(2);
  const cell = { padding: "0.4rem 0.6rem", "border-bottom": "1px solid #eee" } as const;
  // Chart scale: longest income/expense bar across months.
  const maxMonth = createMemo(() => {
    const m = data()?.monthly ?? [];
    return Math.max(1, ...m.map((x) => Math.max(x.income, x.expense)));
  });
  const bar = (v: number, color: string) => (
    <div
      style={{
        background: color,
        height: "0.7rem",
        width: `${(v / maxMonth()) * 100}%`,
        "min-width": v > 0 ? "2px" : "0",
      }}
    />
  );

  return (
    <Show when={data()}>
      {(d) => (
        <main
          style={{
            "font-family": "system-ui, sans-serif",
            "max-width": "64rem",
            margin: "2rem auto",
            padding: "0 1rem",
          }}
        >
          <h1>{t("nav.reports")}</h1>

          {/* RP-4 headline figures */}
          <section
            style={{ display: "flex", gap: "1.5rem", "flex-wrap": "wrap", margin: "1rem 0" }}
          >
            <Figure label={t("reports.income")} value={money(d().dashboard.income)} />
            <Figure label={t("reports.expenses")} value={money(d().dashboard.expenses)} />
            <Figure label={t("reports.commission")} value={money(d().dashboard.commission)} />
            <Show when={d().canSeeNet}>
              <Figure label={t("reports.net")} value={money(d().dashboard.netResult)} />
            </Show>
          </section>

          <p style={{ display: "flex", gap: "1rem", color: "#555" }}>
            <a href="/api/export?report=entries">{t("reports.exportCsv")} (CSV)</a>
            <Show when={d().canSeeNet}>
              <a href={`/api/export?report=pnl&year=${d().year}`}>P&amp;L (CSV)</a>
              <a href="/api/export?report=balance">{t("reports.balance")} (CSV)</a>
            </Show>
            <button type="button" onClick={() => window.print()}>
              {t("reports.print")}
            </button>
          </p>

          {/* RP-1 annual P&L */}
          <h2 style={{ "font-size": "1.1rem" }}>{t("reports.pnl")}</h2>
          <form method="get" style={{ margin: "0.5rem 0" }}>
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
          <table
            style={{ "border-collapse": "collapse", width: "100%", "margin-bottom": "1.5rem" }}
          >
            <tbody>
              <tr>
                <td style={cell}>{t("reports.income")}</td>
                <td style={cell}>{money(d().pnl.income)}</td>
              </tr>
              <tr>
                <td style={cell}>{t("reports.commission")}</td>
                <td style={cell}>{money(d().pnl.commission)}</td>
              </tr>
              <For each={d().pnl.expensesByGroup}>
                {(g) => (
                  <tr>
                    <td style={cell}>{t(`categories.g_${g.group}`)}</td>
                    <td style={cell}>{money(g.eur)}</td>
                  </tr>
                )}
              </For>
              <tr>
                <td style={cell}>{t("reports.totalExpenses")}</td>
                <td style={cell}>{money(d().pnl.totalExpenses)}</td>
              </tr>
              <Show when={d().canSeeNet}>
                <tr>
                  <td style={cell}>
                    <b>{t("reports.net")}</b>
                  </td>
                  <td style={cell}>
                    <b>{money(d().pnl.netResult)}</b>
                  </td>
                </tr>
              </Show>
            </tbody>
          </table>

          {/* RP-2 multi-year balance */}
          <Show when={d().canSeeNet && d().balance.length > 0}>
            <h2 style={{ "font-size": "1.1rem" }}>{t("reports.balance")}</h2>
            <table
              style={{ "border-collapse": "collapse", width: "100%", "margin-bottom": "1.5rem" }}
            >
              <thead>
                <tr>
                  <th style={cell}>{t("bookings.year")}</th>
                  <th style={cell}>{t("reports.income")}</th>
                  <th style={cell}>{t("reports.expenses")}</th>
                  <th style={cell}>{t("reports.commission")}</th>
                  <th style={cell}>{t("reports.net")}</th>
                  <th style={cell}>{t("reports.cumulative")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={d().balance}>
                  {(b) => (
                    <tr>
                      <td style={cell}>{b.year}</td>
                      <td style={cell}>{money(b.income)}</td>
                      <td style={cell}>{money(b.expenses)}</td>
                      <td style={cell}>{money(b.commission)}</td>
                      <td style={cell}>{money(b.net)}</td>
                      <td style={cell}>{money(b.cumulative)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>

          {/* RP-7 commission balance */}
          <Show when={d().commission}>
            {(c) => (
              <p style={{ color: "#555" }}>
                {t("reports.commissionBalance")}: {t("reports.accrued")} {money(c().accrued)} ·{" "}
                {t("reports.settled")} {money(c().settled)} ·{" "}
                <b>
                  {t("reports.owed")} {money(c().owed)}
                </b>
              </p>
            )}
          </Show>

          {/* RP-6 charts */}
          <h2 style={{ "font-size": "1.1rem" }}>{t("reports.charts")}</h2>
          <div style={{ "margin-bottom": "1rem" }}>
            <For each={d().monthly}>
              {(m) => (
                <div
                  style={{
                    display: "grid",
                    "grid-template-columns": "5rem 1fr",
                    gap: "0.5rem",
                    "align-items": "center",
                    margin: "0.15rem 0",
                  }}
                >
                  <span style={{ color: "#555", "font-size": "0.85rem" }}>{m.month}</span>
                  <div>
                    {bar(m.income, "#3a7")}
                    {bar(m.expense, "#c55")}
                  </div>
                </div>
              )}
            </For>
            <p style={{ "font-size": "0.8rem", color: "#777" }}>
              <span style={{ color: "#3a7" }}>■</span> {t("reports.income")} ·{" "}
              <span style={{ color: "#c55" }}>■</span> {t("reports.expenses")}
            </p>
          </div>
          <FxTrend />

          {/* RP-3 bi-monetary ledger */}
          <h2 style={{ "font-size": "1.1rem" }}>{t("reports.entries")}</h2>
          <table style={{ "border-collapse": "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cell}>{t("common.date")}</th>
                <th style={cell}>{t("expenses.detail")}</th>
                <th style={cell}>ARS</th>
                <th style={cell}>EUR</th>
                <th style={cell}>{t("common.rate")}</th>
                <th style={cell}>{t("common.rateDate")}</th>
              </tr>
            </thead>
            <tbody>
              <For each={d().entries}>
                {(e) => (
                  <tr>
                    <td style={cell}>{e.date}</td>
                    <td style={cell}>
                      {e.kind === "booking" ? "🛏️" : "🧾"} {e.detail}
                    </td>
                    <td style={cell}>{money(e.ars)}</td>
                    <td style={cell}>{money(e.eur)}</td>
                    <td style={cell}>{e.fxRate}</td>
                    <td style={cell}>{e.fxRateDate}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </main>
      )}
    </Show>
  );
}

function Figure(props: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "#777", "font-size": "0.8rem" }}>{props.label}</div>
      <div style={{ "font-size": "1.4rem", "font-weight": 600 }}>{props.value} €</div>
    </div>
  );
}
