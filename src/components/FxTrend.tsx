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
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "10px",
          color: "var(--muted)",
          "font-size": "0.875rem",
        }}
      >
        <span class="toolbar-label" style={{ margin: 0 }}>
          {t("fx.trend")}
        </span>
        <svg
          width={w}
          height={h}
          role="img"
          aria-label={t("fx.trend")}
          style={{ "vertical-align": "middle", color: "var(--pos)" }}
        >
          <polyline
            points={sparkline(rates(), w, h)}
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        <b class="num" style={{ color: "var(--ink)" }}>
          {rates()[rates().length - 1]}
        </b>
      </div>
    </Show>
  );
}
