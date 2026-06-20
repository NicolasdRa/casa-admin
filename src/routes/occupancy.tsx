import { createAsync, query } from "@solidjs/router";
import { For } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { listBookings, occupancyByMonth } from "~/db/bookings";
import { db } from "~/db/index";
import { useI18n } from "~/lib/i18n";
import { requireUser } from "~/lib/session";

const occupancyQuery = query(async () => {
  "use server";
  await requireUser();
  return occupancyByMonth(listBookings(db));
}, "occupancy");

export default function Occupancy() {
  const { t } = useI18n();
  const months = createAsync(() => occupancyQuery(), { initialValue: [] });

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("occupancy.title")}</h1>
        </div>
      </header>
      <For each={months()} fallback={<p class="note">{t("bookings.empty")}</p>}>
        {(m) => (
          <section class="panel">
            <div class="panel-head">
              <h2>{m.month}</h2>
            </div>
            <table>
              <tbody>
                <For each={m.bookings}>
                  {(b) => (
                    <tr>
                      <td style={{ width: "8rem" }}>{b.date}</td>
                      <td>{b.guest}</td>
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
