import { createAsync, query } from "@solidjs/router";
import { For } from "solid-js";
import { listBookings, occupancyByMonth } from "~/db/bookings";
import { db } from "~/db/index";
import { useI18n } from "~/lib/i18n";

const occupancyQuery = query(async () => {
  "use server";
  return occupancyByMonth(listBookings(db));
}, "occupancy");

export default function Occupancy() {
  const { t } = useI18n();
  const months = createAsync(() => occupancyQuery(), { initialValue: [] });

  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "40rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>{t("occupancy.title")}</h1>
      <For each={months()} fallback={<p style={{ color: "#999" }}>{t("bookings.empty")}</p>}>
        {(m) => (
          <section style={{ margin: "1rem 0" }}>
            <h2 style={{ "font-size": "1rem", "border-bottom": "1px solid #eee" }}>{m.month}</h2>
            <ul>
              <For each={m.bookings}>
                {(b) => (
                  <li>
                    {b.date} — {b.guest}
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </main>
  );
}
