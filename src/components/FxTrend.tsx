import { A, createAsync, query, useLocation } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import { listFxRates } from "~/db/fx";
import { db } from "~/db/index";
import { type TrendRange, trendRangeStart } from "~/lib/fx";
import { useI18n } from "~/lib/i18n";
import { formatRate } from "~/lib/money";
import { requireUser } from "~/lib/session";
import { sparkline } from "~/lib/sparkline";

const trendRatesQuery = query(async (range: TrendRange) => {
  "use server";
  await requireUser();
  const today = new Date().toISOString().slice(0, 10);
  const from = trendRangeStart(range, today);
  // listFxRates is newest-first; the sparkline wants oldest→newest.
  return listFxRates(db, { from })
    .reverse()
    .map((r) => r.average);
}, "trendFxRates");

const RANGES: { key: TrendRange; label: "fx.rangeWeek" | "fx.rangeMonth" | "fx.rangeYear" }[] = [
  { key: "week", label: "fx.rangeWeek" },
  { key: "month", label: "fx.rangeMonth" },
  { key: "year", label: "fx.rangeYear" },
];

/** FX-9: inline SVG sparkline of recent BNA EUR average rates (no chart library), with a
 *  week/month/year range toggle. Shared by home, reports and the /fx route. */
export function FxTrend() {
  const { t, locale } = useI18n();
  const [range, setRange] = createSignal<TrendRange>("year"); // default: last year
  const rates = createAsync(() => trendRatesQuery(range()), { initialValue: [] });
  const onFxRoute = () => useLocation().pathname === "/fx"; // already here → no self-link
  // Fixed viewBox coords; the SVG scales to the container width (preserveAspectRatio="none"),
  // so the line spans the full card. A non-scaling stroke keeps it crisp at any width.
  const vbW = 600;
  const h = 36;

  return (
    <div style={{ "font-size": "0.875rem", width: "100%", "max-width": "640px" }}>
      <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
        <span class="toolbar-label" style={{ margin: 0 }}>
          {t("fx.trend")}
        </span>
        {/* Range presets — right-aligned; local signal re-queries the sparkline by date range. */}
        <div style={{ display: "flex", gap: "4px", "margin-left": "auto" }}>
          <For each={RANGES}>
            {(r) => (
              <button
                type="button"
                class="btn-ghost"
                aria-pressed={range() === r.key}
                onClick={() => setRange(r.key)}
                style={{
                  padding: "2px 8px",
                  ...(range() === r.key
                    ? {
                        background: "var(--navy)",
                        color: "var(--on-navy)",
                        "border-color": "var(--navy)",
                      }
                    : {}),
                }}
              >
                {t(r.label)}
              </button>
            )}
          </For>
        </div>
      </div>

      <Show
        when={rates().length > 1}
        fallback={
          <p class="note" style={{ "margin-top": "8px" }}>
            {t("fx.empty")}
          </p>
        }
      >
        <svg
          viewBox={`0 0 ${vbW} ${h}`}
          width="100%"
          height={h}
          preserveAspectRatio="none"
          role="img"
          aria-label={t("fx.trend")}
          style={{ display: "block", "margin-top": "8px", color: "var(--pos)" }}
        >
          <polyline
            points={sparkline(rates(), vbW, h)}
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "10px",
            "margin-top": "6px",
            color: "var(--muted)",
          }}
        >
          <b class="num" style={{ color: "var(--ink)" }}>
            {formatRate(rates()[rates().length - 1], locale())} ARS
          </b>
          {/* Explicit action label — right-aligned, the arrow alone wasn't enough of an affordance. */}
          <Show when={!onFxRoute()}>
            <A
              href="/fx"
              style={{
                "margin-left": "auto",
                color: "var(--navy)",
                "font-weight": "600",
                "white-space": "nowrap",
              }}
            >
              {t("fx.viewHistory")} ›
            </A>
          </Show>
        </div>
      </Show>
    </div>
  );
}
