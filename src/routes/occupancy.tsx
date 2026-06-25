import { createAsync, query, useSearchParams } from "@solidjs/router";
import { For } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { listBookings, mergeOccupancy, occupancyByMonth, occupancyPct } from "~/db/bookings";
import { listReservations } from "~/db/externalReservations";
import { db } from "~/db/index";
import { useI18n } from "~/lib/i18n";
import { requireUser } from "~/lib/session";

const occupancyQuery = query(async (range: { from?: string; to?: string }) => {
  "use server";
  await requireUser();
  // Direct bookings grouped by month, with imported OTA blocks (CA-84) folded in beside them.
  return mergeOccupancy(occupancyByMonth(listBookings(db, range)), listReservations(db, range));
}, "occupancy");

export default function Occupancy() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const p = (k: "from" | "to") => {
    const v = params[k];
    return typeof v === "string" && v ? v : undefined;
  };
  const months = createAsync(() => occupancyQuery({ from: p("from"), to: p("to") }), {
    initialValue: [],
  });

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("occupancy.title")}</h1>
        </div>
      </header>

      {/* Date-range filter — plain GET form, URL-driven (works without JS). Filters by check-in. */}
      <form method="get" class="toolbar filter">
        <span class="toolbar-label">{t("bookings.filter")}</span>
        <input type="date" name="from" value={p("from") ?? ""} title={t("bookings.from")} />
        <input type="date" name="to" value={p("to") ?? ""} title={t("bookings.to")} />
        <button type="submit" class="btn-ghost">
          {t("bookings.filter")}
        </button>
      </form>

      <For each={months()} fallback={<p class="note">{t("bookings.empty")}</p>}>
        {(m) => (
          <section class="panel">
            <div class="panel-head">
              <h2>{m.month}</h2>
              <span class="note">
                {t("occupancy.nights", { n: m.nights })} · {occupancyPct(m.month, m.nights)}%
              </span>
            </div>
            <table>
              <tbody>
                <For each={m.bookings}>
                  {(b) => (
                    <tr>
                      <td style={{ width: "11rem" }}>
                        {b.checkOut ? `${b.date} → ${b.checkOut}` : b.date}
                      </td>
                      <td>{b.guest}</td>
                      <td style={{ width: "8rem" }}>
                        <span class={`chan chan-${b.channel}`}>
                          {t(`bookings.channel_${b.channel}` as Parameters<typeof t>[0]) as string}
                        </span>
                      </td>
                    </tr>
                  )}
                </For>
                {/* CA-84: imported OTA blocks — availability only, muted to read as "synced, not a
                    money booking". They carry dates + a feed label, never an amount. */}
                <For each={m.blocks}>
                  {(blk) => (
                    <tr style={{ color: "var(--muted)" }}>
                      <td style={{ width: "11rem" }}>{`${blk.start} → ${blk.end}`}</td>
                      <td>
                        <span class="note">
                          {t("occupancy.synced")}
                          {blk.summary ? ` · ${blk.summary}` : ""}
                        </span>
                      </td>
                      <td style={{ width: "8rem" }}>
                        <span class={`chan chan-${blk.channel}`}>
                          {
                            t(
                              `bookings.channel_${blk.channel}` as Parameters<typeof t>[0],
                            ) as string
                          }
                        </span>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </section>
        )}
      </For>
    </AppShell>
  );
}
