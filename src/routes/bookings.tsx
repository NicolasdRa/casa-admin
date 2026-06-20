import { action, createAsync, query, useSubmission } from "@solidjs/router";
import { For, Show } from "solid-js";
import { createBooking, listBookings } from "~/db/bookings";
import { db } from "~/db/index";
import { useI18n } from "~/lib/i18n";
import { fromCents, toCents } from "~/lib/money";

const listBookingsQuery = query(async () => {
  "use server";
  return listBookings(db);
}, "bookings");

const addBooking = action(async (form: FormData) => {
  "use server";
  const guest = String(form.get("guest") ?? "").trim();
  const date = String(form.get("date") ?? "");
  const currency = form.get("currency") === "ARS" ? "ARS" : "EUR";
  const amount = Number(form.get("amount"));
  if (!guest) return { error: "guest_required" };
  if (!date) return { error: "date_required" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amount_invalid" };
  try {
    createBooking(db, { guest, date, currency, amount: toCents(amount) });
  } catch (e) {
    return { error: (e as Error).message };
  }
  return { ok: true };
}, "addBooking");

export const route = { preload: () => listBookingsQuery() };

export default function Bookings() {
  const { t } = useI18n();
  const bookings = createAsync(() => listBookingsQuery(), { initialValue: [] });
  const submission = useSubmission(addBooking);
  const money = (cents: number) => fromCents(cents).toFixed(2);
  const cell = { padding: "0.4rem 0.6rem", "border-bottom": "1px solid #eee" } as const;

  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "60rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>{t("nav.bookings")}</h1>

      <form
        action={addBooking}
        method="post"
        style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap", margin: "1rem 0" }}
      >
        <input name="guest" placeholder={t("bookings.guest")} required />
        <input type="date" name="date" required />
        <select name="currency">
          <option value="EUR">EUR</option>
          <option value="ARS">ARS</option>
        </select>
        <input
          type="number"
          name="amount"
          step="0.01"
          min="0"
          placeholder={t("common.amount")}
          required
        />
        <button type="submit">{t("common.save")}</button>
      </form>

      <Show when={submission.result?.error}>
        {(err) => <p style={{ color: "crimson" }}>{err()}</p>}
      </Show>

      <table style={{ "border-collapse": "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{t("common.date")}</th>
            <th style={cell}>{t("bookings.guest")}</th>
            <th style={cell}>EUR</th>
            <th style={cell}>ARS</th>
            <th style={cell}>{t("common.rate")}</th>
            <th style={cell}>{t("common.rateDate")}</th>
            <th style={cell}>{t("bookings.commission")}</th>
          </tr>
        </thead>
        <tbody>
          <For
            each={bookings()}
            fallback={
              <tr>
                <td colspan="7" style={cell}>
                  {t("bookings.empty")}
                </td>
              </tr>
            }
          >
            {(b) => (
              <tr>
                <td style={cell}>{b.date}</td>
                <td style={cell}>{b.guest}</td>
                <td style={cell}>{money(b.amountEur)}</td>
                <td style={cell}>{money(b.amountArs)}</td>
                <td style={cell}>{b.fxRate}</td>
                <td style={cell}>{b.fxRateDate}</td>
                <td style={cell}>{money(b.commissionEur)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </main>
  );
}
