import { A, createAsync, query } from "@solidjs/router";
import { For, Show } from "solid-js";
import { db } from "~/db/index";
import { biMonetaryEntries } from "~/db/reports";
import { useI18n } from "~/lib/i18n";
import { formatMoney } from "~/lib/money";
import { requireUser } from "~/lib/session";

const RECENT = 8; // newest entries shown on the panel; full history lives on /reports.

export const recentActivityQuery = query(async () => {
  "use server";
  await requireUser();
  return biMonetaryEntries(db).slice(0, RECENT);
}, "recentActivity");

/** Panel zone ③ — the present: newest bookings/expenses as a compact bi-monetary feed, the
 *  at-a-glance density that made the spreadsheet trusted. Full, paginated ledger is on /reports. */
export function RecentActivity() {
  const { t, locale } = useI18n();
  const rows = createAsync(() => recentActivityQuery(), { initialValue: [] });
  const money = (c: number) => formatMoney(c, locale());

  return (
    <Show when={rows().length > 0} fallback={<p class="empty-note">{t("panel.noActivity")}</p>}>
      <ul class="activity">
        <For each={rows()}>
          {(r) => (
            <li>
              <span class="a-date num">{r.date}</span>
              <span class={`a-kind k-${r.kind}`}>
                {t(r.kind === "booking" ? "panel.kind_booking" : "panel.kind_expense")}
              </span>
              <span class="a-detail">{r.detail}</span>
              <span class="a-eur num">{money(r.eur)} €</span>
            </li>
          )}
        </For>
      </ul>
      <A href="/reports" class="activity-all">
        {t("panel.viewAll")} →
      </A>
    </Show>
  );
}
