import { action, createAsync, query, useSearchParams, useSubmission } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { FxPreview } from "~/components/FxPreview";
import { createBooking, listBookings, summarizeBookings } from "~/db/bookings";
import { db } from "~/db/index";
import { useI18n } from "~/lib/i18n";
import { fromCents, toCents } from "~/lib/money";

interface Filter {
  year?: string;
  guest?: string;
  from?: string;
  to?: string;
}

const listBookingsQuery = query(async (filter: Filter) => {
  "use server";
  return listBookings(db, filter);
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

export default function Bookings() {
  const { t } = useI18n();
  const [date, setDate] = createSignal("");
  const [amount, setAmount] = createSignal(0);
  const [currency, setCurrency] = createSignal<"ARS" | "EUR">("EUR");
  const [params] = useSearchParams();
  const p = (k: keyof Filter) => {
    const v = params[k];
    return typeof v === "string" && v ? v : undefined;
  };
  const bookings = createAsync(
    () => listBookingsQuery({ year: p("year"), guest: p("guest"), from: p("from"), to: p("to") }),
    { initialValue: [] },
  );
  const summary = createMemo(() => summarizeBookings(bookings()));
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
        <input
          type="date"
          name="date"
          required
          value={date()}
          onInput={(e) => setDate(e.currentTarget.value)}
        />
        <select
          name="currency"
          value={currency()}
          onChange={(e) => setCurrency(e.currentTarget.value as "ARS" | "EUR")}
        >
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
          value={amount() || ""}
          onInput={(e) => setAmount(Number(e.currentTarget.value))}
        />
        <button type="submit">{t("common.save")}</button>
      </form>

      <FxPreview date={date()} amount={amount()} currency={currency()} />

      <Show when={submission.result?.error}>
        {(err) => <p style={{ color: "crimson" }}>{err()}</p>}
      </Show>

      {/* Filters — plain GET form, URL-driven (works without JS). */}
      <form
        method="get"
        style={{
          display: "flex",
          gap: "0.5rem",
          "flex-wrap": "wrap",
          margin: "1rem 0",
          color: "#555",
        }}
      >
        <input name="year" placeholder={t("bookings.year")} value={p("year") ?? ""} size="6" />
        <input name="guest" placeholder={t("bookings.guest")} value={p("guest") ?? ""} />
        <input type="date" name="from" value={p("from") ?? ""} title={t("bookings.from")} />
        <input type="date" name="to" value={p("to") ?? ""} title={t("bookings.to")} />
        <button type="submit">{t("bookings.filter")}</button>
      </form>

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

      <Show when={summary().years.length > 0}>
        <h2 style={{ "margin-top": "2rem", "font-size": "1.1rem" }}>{t("bookings.total")}</h2>
        <table style={{ "border-collapse": "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={cell}>{t("bookings.year")}</th>
              <th style={cell}>{t("bookings.count")}</th>
              <th style={cell}>EUR</th>
              <th style={cell}>ARS</th>
              <th style={cell}>{t("bookings.commission")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={summary().years}>
              {(y) => (
                <tr>
                  <td style={cell}>{y.year}</td>
                  <td style={cell}>{y.count}</td>
                  <td style={cell}>{money(y.incomeEur)}</td>
                  <td style={cell}>{money(y.incomeArs)}</td>
                  <td style={cell}>{money(y.commissionEur)}</td>
                </tr>
              )}
            </For>
            <tr style={{ "font-weight": "bold" }}>
              <td style={cell}>{t("bookings.total")}</td>
              <td style={cell}>{summary().total.count}</td>
              <td style={cell}>{money(summary().total.incomeEur)}</td>
              <td style={cell}>{money(summary().total.incomeArs)}</td>
              <td style={cell}>{money(summary().total.commissionEur)}</td>
            </tr>
          </tbody>
        </table>
      </Show>
    </main>
  );
}
