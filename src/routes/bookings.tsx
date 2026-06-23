import { A, action, createAsync, query, useSearchParams, useSubmission } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { FxPreview } from "~/components/FxPreview";
import { Modal } from "~/components/Modal";
import {
  accruedCommissionEur,
  createBooking,
  listBookings,
  summarizeBookings,
} from "~/db/bookings";
import { db } from "~/db/index";
import { createEntityForm } from "~/lib/createEntityForm";
import { useI18n } from "~/lib/i18n";
import { formatMoney, toCents } from "~/lib/money";
import { runMutation } from "~/lib/mutation";
import { requireUser } from "~/lib/session";

interface Filter {
  year?: string;
  guest?: string;
  from?: string;
  to?: string;
  channel?: "direct" | "booking" | "airbnb";
}

type BookingChannel = "direct" | "booking" | "airbnb";
type BookingChannelKey =
  | "bookings.channel_direct"
  | "bookings.channel_booking"
  | "bookings.channel_airbnb";

const bookingChannelKey: Record<BookingChannel, BookingChannelKey> = {
  direct: "bookings.channel_direct",
  booking: "bookings.channel_booking",
  airbnb: "bookings.channel_airbnb",
};

const listBookingsQuery = query(async (filter: Filter) => {
  "use server";
  await requireUser();
  return listBookings(db, filter);
}, "bookings");

const addBooking = action(async (form: FormData) => {
  "use server";
  await requireUser();
  const guest = String(form.get("guest") ?? "").trim();
  const date = String(form.get("date") ?? "");
  const checkOut = String(form.get("checkOut") ?? "") || undefined;
  const currency = form.get("currency") === "ARS" ? "ARS" : "EUR";
  const amount = Number(form.get("amount"));
  const typeRaw = form.get("type");
  const type = typeRaw === "cancellation" || typeRaw === "reimbursement" ? typeRaw : "booking";
  const channelRaw = form.get("channel");
  const channel = channelRaw === "booking" || channelRaw === "airbnb" ? channelRaw : "direct";
  const manualRaw = Number(form.get("manualRate"));
  const manualRate = Number.isFinite(manualRaw) && manualRaw > 0 ? manualRaw : undefined;
  if (!guest) return { error: "guestRequired" };
  if (!date) return { error: "dateRequired" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amountInvalid" };
  return runMutation({ audit: ["create", "booking"] }, () => {
    createBooking(db, {
      guest,
      date,
      checkOut,
      currency,
      amount: toCents(amount),
      type,
      channel,
      manualRate,
    });
  });
}, "addBooking");

const accruedQuery = query(async () => {
  "use server";
  await requireUser();
  return accruedCommissionEur(db);
}, "accruedCommission");

export default function Bookings() {
  const { t, locale } = useI18n();
  const [date, setDate] = createSignal("");
  const [amount, setAmount] = createSignal(0);
  const [currency, setCurrency] = createSignal<"ARS" | "EUR">("EUR");
  const [params] = useSearchParams();
  const p = (k: keyof Filter) => {
    const v = params[k];
    return typeof v === "string" && v ? v : undefined;
  };
  const channelParam = () => {
    const c = params.channel;
    return c === "booking" || c === "airbnb" || c === "direct" ? c : undefined;
  };
  const bookings = createAsync(
    () =>
      listBookingsQuery({
        year: p("year"),
        guest: p("guest"),
        from: p("from"),
        to: p("to"),
        channel: channelParam(),
      }),
    { initialValue: [] },
  );
  const summary = createMemo(() => summarizeBookings(bookings()));
  const accrued = createAsync(() => accruedQuery(), { initialValue: 0 });
  const submission = useSubmission(addBooking);
  const money = (cents: number) => formatMoney(cents, locale());
  const channelLabel = (c: BookingChannel) => t(bookingChannelKey[c]);
  // Translate a returned error code to a localized message; raw codes never render.
  const errMsg = (code: string) => t(`bookings.err_${code}` as Parameters<typeof t>[0]) as string;
  const form = createEntityForm(submission, () => {
    setDate("");
    setAmount(0);
    setCurrency("EUR");
  });

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
        <div class="page-head-actions">
          <button type="button" onClick={form.openForm}>
            + {t("bookings.add")}
          </button>
        </div>
      </header>

      <Modal open={form.open()} onClose={() => form.setOpen(false)} title={t("bookings.add")}>
        <form ref={form.setRef} action={addBooking} method="post" class="toolbar entry-form">
          <label class="tb-field tb-grow">
            <span>{t("bookings.guest")}</span>
            <input name="guest" required />
          </label>
          <label class="tb-field">
            <span>{t("bookings.checkIn")}</span>
            <input
              type="date"
              name="date"
              required
              value={date()}
              onInput={(e) => setDate(e.currentTarget.value)}
            />
          </label>
          <label class="tb-field">
            <span>{t("bookings.checkOut")}</span>
            <input type="date" name="checkOut" min={date() || undefined} />
          </label>
          <label class="tb-field">
            <span>{t("common.amount")}</span>
            <input
              type="number"
              name="amount"
              step="0.01"
              min="0"
              required
              value={amount() || ""}
              onInput={(e) => setAmount(Number(e.currentTarget.value))}
            />
          </label>
          <label class="tb-field">
            <span>{t("common.currency")}</span>
            <select
              name="currency"
              value={currency()}
              onChange={(e) => setCurrency(e.currentTarget.value as "ARS" | "EUR")}
            >
              <option value="EUR">EUR</option>
              <option value="ARS">ARS</option>
            </select>
          </label>
          <label class="tb-field">
            <span>{t("bookings.type")}</span>
            <select name="type">
              <option value="booking">{t("bookings.type_booking")}</option>
              <option value="cancellation">{t("bookings.type_cancellation")}</option>
              <option value="reimbursement">{t("bookings.type_reimbursement")}</option>
            </select>
          </label>
          <label class="tb-field">
            <span>{t("bookings.channel")}</span>
            <select name="channel">
              <option value="direct">{t("bookings.channel_direct")}</option>
              <option value="booking">{t("bookings.channel_booking")}</option>
              <option value="airbnb">{t("bookings.channel_airbnb")}</option>
            </select>
          </label>
          <label class="tb-field">
            <span>{t("common.manualRate")}</span>
            <input type="number" name="manualRate" step="0.01" min="0" size="8" />
          </label>
          <button type="submit" disabled={submission.pending}>
            {submission.pending ? t("common.saving") : t("common.save")}
          </button>
        </form>

        <FxPreview date={date()} amount={amount()} currency={currency()} />

        <Show when={submission.result?.ok}>
          <p class="alert alert-success" role="status">
            {t("common.saved")}
          </p>
        </Show>
        <Show when={submission.result?.error}>
          {(err) => (
            <p class="alert alert-error" role="alert">
              {errMsg(err())}
            </p>
          )}
        </Show>
      </Modal>

      {/* Filters — plain GET form, URL-driven (works without JS). */}
      <form method="get" class="toolbar filter">
        <span class="toolbar-label">{t("bookings.filter")}</span>
        <input name="year" placeholder={t("bookings.year")} value={p("year") ?? ""} size="6" />
        <input name="guest" placeholder={t("bookings.guest")} value={p("guest") ?? ""} />
        <input type="date" name="from" value={p("from") ?? ""} title={t("bookings.from")} />
        <input type="date" name="to" value={p("to") ?? ""} title={t("bookings.to")} />
        <select name="channel" title={t("bookings.channel")}>
          <option value="">{t("bookings.channel_all")}</option>
          <option value="direct" selected={channelParam() === "direct"}>
            {t("bookings.channel_direct")}
          </option>
          <option value="booking" selected={channelParam() === "booking"}>
            {t("bookings.channel_booking")}
          </option>
          <option value="airbnb" selected={channelParam() === "airbnb"}>
            {t("bookings.channel_airbnb")}
          </option>
        </select>
        <button type="submit" class="btn-ghost">
          {t("bookings.filter")}
        </button>
      </form>

      <div class="panel table-scroll">
        <table class="cards">
          <thead>
            <tr>
              <th>{t("bookings.checkIn")}</th>
              <th>{t("bookings.checkOut")}</th>
              <th>{t("bookings.guest")}</th>
              <th>{t("bookings.channel")}</th>
              <th class="num">EUR</th>
              <th class="num">{t("bookings.commission")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={bookings()} fallback={<EmptyRow cols={6} text={t("bookings.empty")} />}>
              {(b) => (
                <tr>
                  <td>{b.date}</td>
                  <td data-label={t("bookings.checkOut")}>{b.checkOut ?? "—"}</td>
                  <td data-label={t("bookings.guest")}>{b.guest}</td>
                  <td data-label={t("bookings.channel")}>
                    <span class={`chan chan-${b.channel}`}>{channelLabel(b.channel)}</span>
                  </td>
                  <td class="num" data-label="EUR">
                    {money(b.amountEur)}
                  </td>
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
                      <td class="num">{money(y.commissionEur)}</td>
                    </tr>
                  )}
                </For>
                <tr class="total">
                  <td>{t("bookings.total")}</td>
                  <td class="num">{summary().total.count}</td>
                  <td class="num">{money(summary().total.incomeEur)}</td>
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
