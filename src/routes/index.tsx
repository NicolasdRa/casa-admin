import { A } from "@solidjs/router";
import { AppShell } from "~/components/AppShell";
import { FxTrend } from "~/components/FxTrend";
import { useI18n } from "~/lib/i18n";

export default function Dashboard() {
  const { t } = useI18n();

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("app.title")}</h1>
          <p class="sub">{t("app.subtitle")}</p>
        </div>
      </header>

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
