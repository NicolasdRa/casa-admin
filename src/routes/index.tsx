import { A, createAsync, query } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { FxTrend } from "~/components/FxTrend";
import { IncomeExpenseChart } from "~/components/IncomeExpenseChart";
import { NeedsAttention } from "~/components/NeedsAttention";
import { RecentActivity } from "~/components/RecentActivity";
import { db } from "~/db/index";
import { type Period, periodSummary } from "~/db/reports";
import { pctChange } from "~/lib/delta";
import { useI18n } from "~/lib/i18n";
import { formatMoney } from "~/lib/money";
import { requireUser } from "~/lib/session";

// Period-scoped headline figures. `period` null on first load → server resolves the per-role
// default (owner reasons in years, the on-the-ground manager in months) and echoes it back so the
// selector reflects it. canSeeNet mirrors reports' RP-4 gate (co-hosts never receive net).
const scorecardQuery = query(async (period: Period | null) => {
  "use server";
  const me = await requireUser();
  const today = new Date().toISOString().slice(0, 10);
  const resolved: Period = period ?? (me.role === "superadmin" ? "year" : "month");
  return { canSeeNet: me.role !== "user", ...periodSummary(db, resolved, today) };
}, "panelScorecard");

const PERIODS: Period[] = ["month", "year", "all"];

export default function Dashboard() {
  const { t, locale } = useI18n();
  const [chosen, setChosen] = createSignal<Period | null>(null);
  const s = createAsync(() => scorecardQuery(chosen()), { initialValue: null });
  const money = (c: number) => formatMoney(c, locale());
  // null when there's no prior period ("all") — Figure then renders no delta.
  const delta = (cur: number, prev?: number) => (prev == null ? null : pctChange(cur, prev));

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("app.title")}</h1>
          <p class="sub">{t("app.subtitle")}</p>
        </div>
        <div class="page-head-actions">
          <select
            class="period-select"
            value={s()?.period ?? ""}
            onChange={(e) => setChosen(e.currentTarget.value as Period)}
          >
            {PERIODS.map((p) => (
              <option value={p}>{t(`panel.period_${p}`)}</option>
            ))}
          </select>
          {/* Quick actions — verbs, top-right like every other page. */}
          <A class="btn btn-ghost" href="/bookings">
            {t("panel.quick_newBooking")}
          </A>
          <A class="btn btn-ghost" href="/expenses">
            {t("panel.quick_newExpense")}
          </A>
          <A class="btn btn-ghost" href="/caja">
            {t("panel.quick_caja")}
          </A>
        </div>
      </header>

      {/* ② Scorecard — figures scoped to the period, each with a delta vs the prior period. */}
      <Show when={s()}>
        {(d) => (
          <section class="panel stats">
            <Figure
              label={t("reports.income")}
              value={money(d().income)}
              delta={delta(d().income, d().prev?.income)}
              vs={t("panel.vsPrevious")}
            />
            <Figure
              label={t("reports.expenses")}
              value={money(d().expenses)}
              delta={delta(d().expenses, d().prev?.expenses)}
              vs={t("panel.vsPrevious")}
            />
            <Figure
              label={t("reports.commission")}
              value={money(d().commission)}
              delta={delta(d().commission, d().prev?.commission)}
              vs={t("panel.vsPrevious")}
            />
            <Show when={d().canSeeNet}>
              <Figure
                label={t("reports.net")}
                value={money(d().netResult)}
                delta={delta(d().netResult, d().prev?.netResult)}
                vs={t("panel.vsPrevious")}
              />
            </Show>
          </section>
        )}
      </Show>

      {/* ③ Present + leading: what just happened, and what needs me. */}
      <div class="panel-grid">
        <section class="panel">
          <div class="panel-head">
            <h2>{t("panel.recentActivity")}</h2>
          </div>
          <div class="panel-pad">
            <RecentActivity />
          </div>
        </section>
        <div class="panel-col">
          <section class="panel">
            <div class="panel-head">
              <h2>{t("panel.needsAttention")}</h2>
            </div>
            <div class="panel-pad">
              <NeedsAttention />
            </div>
          </section>
          {/* FX trend — its own card, under Needs attention on desktop, stacked on mobile. */}
          <section class="panel">
            <div class="panel-pad">
              <FxTrend />
            </div>
          </section>
        </div>
      </div>

      {/* ④ Trend — recent income vs expense (full history on /reports). */}
      <section class="panel">
        <div class="panel-head">
          <h2>{t("panel.incomeVsExpense")}</h2>
        </div>
        <div class="panel-pad">
          <IncomeExpenseChart months={6} />
        </div>
      </section>
    </AppShell>
  );
}

// Delta carries direction via arrow + sign (never color alone — AA / colour-blind safe). Muted,
// because a rise in expenses isn't "bad" and a rise in net isn't "good"; we report, not editorialise.
function Figure(props: { label: string; value: string; delta?: number | null; vs: string }) {
  const arrow = (n: number) => (n > 0 ? "▲" : n < 0 ? "▼" : "▬");
  const d = () => props.delta;
  return (
    <div class="stat">
      <div class="k">{props.label}</div>
      <div class="v">{props.value} €</div>
      <Show when={d() != null}>
        <div class="delta" title={props.vs}>
          {arrow(d() ?? 0)} {Math.abs(d() ?? 0)}%
        </div>
      </Show>
    </div>
  );
}
