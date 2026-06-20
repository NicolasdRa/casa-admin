import { A, action, createAsync, query, useSearchParams, useSubmission } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { FxPreview } from "~/components/FxPreview";
import {
  accruedCommissionEur,
  createBooking,
  listBookings,
  summarizeBookings,
} from "~/db/bookings";
import { db } from "~/db/index";
import { useI18n } from "~/lib/i18n";
import { fromCents, toCents } from "~/lib/money";
import { requireUser } from "~/lib/session";

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
  const typeRaw = form.get("type");
  const type = typeRaw === "cancellation" || typeRaw === "reimbursement" ? typeRaw : "booking";
  const manualRaw = Number(form.get("manualRate"));
  const manualRate = Number.isFinite(manualRaw) && manualRaw > 0 ? manualRaw : undefined;
  if (!guest) return { error: "guest_required" };
  if (!date) return { error: "date_required" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amount_invalid" };
  try {
    createBooking(db, { guest, date, currency, amount: toCents(amount), type, manualRate });
  } catch (e) {
    return { error: (e as Error).message };
  }
  return { ok: true };
}, "addBooking");

const accruedQuery = query(async () => {
  "use server";
  await requireUser();
  return accruedCommissionEur(db);
}, "accruedCommission");

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
  const accrued = createAsync(() => accruedQuery(), { initialValue: 0 });
  const submission = useSubmission(addBooking);
  const money = (cents: number) => fromCents(cents).toFixed(2);

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("nav.bookings")}</h1>
          <p class="sub">
            {t("bookings.accrued")}: <b>{money(accrued())} EUR</b> ·{" "}
            <A href="/occupancy">{t("bookings.occupancy")}</A>
          </p>
        </div>
      </header>

      <form action={addBooking} method="post" class="toolbar">
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
        <select name="type">
          <option value="booking">{t("bookings.type_booking")}</option>
          <option value="cancellation">{t("bookings.type_cancellation")}</option>
          <option value="reimbursement">{t("bookings.type_reimbursement")}</option>
        </select>
        <input
          type="number"
          name="manualRate"
          step="0.01"
          min="0"
          placeholder={t("common.manualRate")}
          title={t("common.manualRate")}
          size="8"
        />
        <button type="submit">{t("common.save")}</button>
      </form>

      <FxPreview date={date()} amount={amount()} currency={currency()} />

      <Show when={submission.result?.error}>
        {(err) => <p class="alert alert-error">{err()}</p>}
      </Show>

      {/* Filters — plain GET form, URL-driven (works without JS). */}
      <form method="get" class="toolbar filter">
        <span class="toolbar-label">{t("bookings.filter")}</span>
        <input name="year" placeholder={t("bookings.year")} value={p("year") ?? ""} size="6" />
        <input name="guest" placeholder={t("bookings.guest")} value={p("guest") ?? ""} />
        <input type="date" name="from" value={p("from") ?? ""} title={t("bookings.from")} />
        <input type="date" name="to" value={p("to") ?? ""} title={t("bookings.to")} />
        <button type="submit" class="btn-ghost">
          {t("bookings.filter")}
        </button>
      </form>

      <div class="panel table-scroll">
        <table class="cards">
          <thead>
            <tr>
              <th>{t("common.date")}</th>
              <th>{t("bookings.guest")}</th>
              <th class="num">EUR</th>
              <th class="num">ARS</th>
              <th class="num">{t("common.rate")}</th>
              <th>{t("common.rateDate")}</th>
              <th class="num">{t("bookings.commission")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={bookings()} fallback={<EmptyRow cols={7} text={t("bookings.empty")} />}>
              {(b) => (
                <tr>
                  <td>{b.date}</td>
                  <td data-label={t("bookings.guest")}>{b.guest}</td>
                  <td class="num" data-label="EUR">
                    {money(b.amountEur)}
                  </td>
                  <td class="num" data-label="ARS">
                    {money(b.amountArs)}
                  </td>
                  <td class="num" data-label={t("common.rate")}>
                    {b.fxRate}
                  </td>
                  <td data-label={t("common.rateDate")}>{b.fxRateDate}</td>
                  <td class="num" data-label={t("bookings.commission")}>
                    {money(b.commissionEur)}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      <Show when={summary().years.length > 0}>
        <section class="panel">
          <div class="panel-head">
            <h2>{t("bookings.total")}</h2>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("bookings.year")}</th>
                  <th class="num">{t("bookings.count")}</th>
                  <th class="num">EUR</th>
                  <th class="num">ARS</th>
                  <th class="num">{t("bookings.commission")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={summary().years}>
                  {(y) => (
                    <tr>
                      <td>{y.year}</td>
                      <td class="num">{y.count}</td>
                      <td class="num">{money(y.incomeEur)}</td>
                      <td class="num">{money(y.incomeArs)}</td>
                      <td class="num">{money(y.commissionEur)}</td>
                    </tr>
                  )}
                </For>
                <tr class="total">
                  <td>{t("bookings.total")}</td>
                  <td class="num">{summary().total.count}</td>
                  <td class="num">{money(summary().total.incomeEur)}</td>
                  <td class="num">{money(summary().total.incomeArs)}</td>
                  <td class="num">{money(summary().total.commissionEur)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </Show>
    </AppShell>
  );
}

function EmptyRow(props: { cols: number; text: string }) {
  return (
    <tr>
      <td colspan={props.cols} class="note">
        {props.text}
      </td>
    </tr>
  );
}
