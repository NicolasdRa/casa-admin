import { createAsync, query, useSearchParams } from "@solidjs/router";
import { For } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { FxTrend } from "~/components/FxTrend";
import { listFxRates } from "~/db/fx";
import { db } from "~/db/index";
import { useI18n } from "~/lib/i18n";
import { formatRate } from "~/lib/money";
import { requireUser } from "~/lib/session";

const fxRatesQuery = query(async (range: { from?: string; to?: string }) => {
  "use server";
  await requireUser();
  return listFxRates(db, range);
}, "fxRates");

export default function FxHistory() {
  const { t, locale } = useI18n();
  const rate = (n: number) => formatRate(n, locale());
  const [params] = useSearchParams();
  const p = (k: "from" | "to") => {
    const v = params[k];
    return typeof v === "string" && v ? v : undefined;
  };
  const rates = createAsync(() => fxRatesQuery({ from: p("from"), to: p("to") }), {
    initialValue: [],
  });

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("fx.history")}</h1>
          <p class="sub">{t("fx.trend")}</p>
        </div>
      </header>

      <section class="panel panel-pad">
        <FxTrend />
      </section>

      {/* Date-range filter — plain GET form, URL-driven (works without JS). */}
      <form method="get" class="toolbar filter">
        <span class="toolbar-label">{t("bookings.filter")}</span>
        <input type="date" name="from" value={p("from") ?? ""} title={t("bookings.from")} />
        <input type="date" name="to" value={p("to") ?? ""} title={t("bookings.to")} />
        <button type="submit" class="btn-ghost">
          {t("bookings.filter")}
        </button>
      </form>

      <div class="panel table-scroll">
        <table class="cards">
          <thead>
            <tr>
              <th>{t("common.date")}</th>
              <th class="num">{t("fx.compra")} (ARS)</th>
              <th class="num">{t("fx.venta")} (ARS)</th>
              <th class="num">{t("fx.average")} (ARS)</th>
              <th>{t("fx.source")}</th>
            </tr>
          </thead>
          <tbody>
            <For
              each={rates()}
              fallback={
                <tr>
                  <td colspan={5} class="note">
                    {t("fx.empty")}
                  </td>
                </tr>
              }
            >
              {(r) => (
                <tr>
                  <td>{r.date}</td>
                  <td class="num" data-label={t("fx.compra")}>
                    {rate(r.compra)}
                  </td>
                  <td class="num" data-label={t("fx.venta")}>
                    {rate(r.venta)}
                  </td>
                  <td class="num" data-label={t("fx.average")}>
                    {rate(r.average)}
                  </td>
                  <td data-label={t("fx.source")}>{r.source}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
