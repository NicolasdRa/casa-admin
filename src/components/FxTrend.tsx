import { createAsync, query } from "@solidjs/router";
import { Show } from "solid-js";
import { listRecentFxRates } from "~/db/fx";
import { db } from "~/db/index";
import { useI18n } from "~/lib/i18n";
import { requireUser } from "~/lib/session";
import { sparkline } from "~/lib/sparkline";

const recentRatesQuery = query(async () => {
  "use server";
  await requireUser();
  return listRecentFxRates(db, 30).map((r) => r.average);
}, "recentFxRates");

/** FX-9: inline SVG sparkline of recent BNA EUR average rates (no chart library). */
export function FxTrend() {
  const { t } = useI18n();
  const rates = createAsync(() => recentRatesQuery(), { initialValue: [] });
  const w = 120;
  const h = 28;

  return (
    <Show when={rates().length > 1}>
      <div style={{ color: "#555", "font-size": "0.85rem", margin: "0.5rem 0" }}>
        {t("fx.trend")}:{" "}
        <svg
          width={w}
          height={h}
          role="img"
          aria-label={t("fx.trend")}
          style={{ "vertical-align": "middle" }}
        >
          <polyline
            points={sparkline(rates(), w, h)}
            fill="none"
            stroke="#3a7"
            stroke-width="1.5"
          />
        </svg>{" "}
        <span>{rates()[rates().length - 1]}</span>
      </div>
    </Show>
  );
}
