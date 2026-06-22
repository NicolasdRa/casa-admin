import { A, createAsync, query } from "@solidjs/router";
import { Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { FxTrend } from "~/components/FxTrend";
import { db } from "~/db/index";
import { dashboardSummary } from "~/db/reports";
import { useI18n } from "~/lib/i18n";
import { fromCents } from "~/lib/money";
import { requireUser } from "~/lib/session";

// Headline figures for the landing page — reuses the reports aggregation. canSeeNet mirrors
// reports' RP-4 gate so co-hosts (role "user") never see net here either.
const summaryQuery = query(async () => {
  "use server";
  const me = await requireUser();
  return { canSeeNet: me.role !== "user", ...dashboardSummary(db) };
}, "dashboardSummary");

export default function Dashboard() {
  const { t } = useI18n();
  const summary = createAsync(() => summaryQuery(), { initialValue: null });
  const money = (c: number) => fromCents(c).toFixed(2);

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("app.title")}</h1>
          <p class="sub">{t("app.subtitle")}</p>
        </div>
      </header>

      <Show when={summary()}>
        {(s) => (
          <section class="panel stats">
            <Figure label={t("reports.income")} value={money(s().income)} />
            <Figure label={t("reports.expenses")} value={money(s().expenses)} />
            <Figure label={t("reports.commission")} value={money(s().commission)} />
            <Show when={s().canSeeNet}>
              <Figure label={t("reports.net")} value={money(s().netResult)} />
            </Show>
          </section>
        )}
      </Show>

      <section class="panel">
        <div class="panel-head">
          <h2>{t("fx.trend")}</h2>
        </div>
        <div class="panel-pad">
          <FxTrend />
        </div>
      </section>

      <nav class="dash-links">
        <A href="/bookings">{t("nav.bookings")}</A>
        <A href="/expenses">{t("nav.expenses")}</A>
        <A href="/maintenance">{t("nav.tasks")}</A>
        <A href="/occupancy">{t("bookings.occupancy")}</A>
      </nav>
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
