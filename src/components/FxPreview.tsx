import { createAsync, query } from "@solidjs/router";
import { Show } from "solid-js";
import { getFxRate } from "~/db/fx";
import { db } from "~/db/index";
import { snapshot } from "~/lib/fx";
import { useI18n } from "~/lib/i18n";
import { formatMoney, toCents } from "~/lib/money";
import { requireUser } from "~/lib/session";

const rateForDate = query(async (date: string) => {
  "use server";
  await requireUser();
  return getFxRate(db, date);
}, "rateForDate");

/**
 * FX-5: shows the BNA rate that will be snapshotted for `date` and the resulting converted
 * amount, live, before the user saves. The rate comes from the server (by date); the conversion
 * is the same pure `snapshot()` used at save time, so the preview matches what gets stored.
 */
export function FxPreview(props: {
  date: string;
  amount: number;
  currency: "ARS" | "EUR";
  // CA-89: when set, a missing rate is retrieved from BNA on save (the closest historical quote),
  // so the preview reassures instead of warning about a manual rate.
  autoFetch?: boolean;
}) {
  const { t, locale } = useI18n();
  const rate = createAsync(() => (props.date ? rateForDate(props.date) : Promise.resolve(null)));
  const converted = () => {
    const r = rate();
    if (!r || !Number.isFinite(props.amount) || props.amount <= 0) return null;
    const s = snapshot(toCents(props.amount), props.currency, r.average);
    return { eur: formatMoney(s.amountEur, locale()), ars: formatMoney(s.amountArs, locale()) };
  };

  return (
    <Show when={props.date && rate() !== undefined}>
      <Show
        when={rate()}
        fallback={
          <Show when={props.autoFetch} fallback={<p class="note note-neg">{t("fx.noRate")}</p>}>
            <p class="note">{t("fx.willFetch")}</p>
          </Show>
        }
      >
        {(r) => (
          <p class="note">
            {t("common.rate")}: {r().average} ({r().date})
            <Show when={converted()}>
              {(c) => (
                <span>
                  {" "}
                  — ≈ {c().eur} EUR / {c().ars} ARS
                </span>
              )}
            </Show>
          </p>
        )}
      </Show>
    </Show>
  );
}
