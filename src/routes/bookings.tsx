import {
  A,
  action,
  createAsync,
  query,
  redirect,
  useSearchParams,
  useSubmission,
} from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { useConfirm } from "~/components/ConfirmProvider";
import { FxPreview } from "~/components/FxPreview";
import { Modal } from "~/components/Modal";
import {
  accruedCommissionEur,
  type Conflict,
  createBooking,
  deleteBooking,
  deleteBookings,
  editBookingDetails,
  findConflicts,
  listBookings,
  summarizeBookings,
} from "~/db/bookings";
import { bookingPayments, editCashEntryDate, registerBookingPayment } from "~/db/cash";
import { db } from "~/db/index";
import { listPartners } from "~/db/partners";
import { listUsers } from "~/db/users";
import { createEntityForm } from "~/lib/createEntityForm";
import { useI18n } from "~/lib/i18n";
import { formatMoney, toCents } from "~/lib/money";
import { runMutation } from "~/lib/mutation";
import { can } from "~/lib/permissions";
import { currentUser, requireUser } from "~/lib/session";

// Today in the local calendar — the manager logs the day the cash actually landed (matches Caja).
const todayLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

type Booking = Awaited<ReturnType<typeof listBookings>>[number];

// Edit/delete/bulk mutate frozen financial records, so they're superadmin-only; the list and the
// add form stay open to any signed-in user (matching addBooking's gate).
async function requireSuperadmin() {
  const me = await currentUser();
  if (!me || me.role !== "superadmin") throw redirect("/");
  return me;
}

// Dismiss the native popover a menu button lives in — top-layer menus don't close on inner clicks.
function closePopover(el: HTMLElement) {
  el.closest<HTMLElement>("[popover]")?.hidePopover();
}

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
  const type = typeRaw === "cancellation" || typeRaw === "damage" ? typeRaw : "booking";
  const channelRaw = form.get("channel");
  const channel = channelRaw === "booking" || channelRaw === "airbnb" ? channelRaw : "direct";
  const manualRaw = Number(form.get("manualRate"));
  const manualRate = Number.isFinite(manualRaw) && manualRaw > 0 ? manualRaw : undefined;
  const coHostUserId = Number(form.get("coHostUserId")) || null;
  if (!guest) return { error: "guestRequired" };
  if (!date) return { error: "dateRequired" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amountInvalid" };
  // CA-86: a date-range stay can clash with an existing booking or a synced OTA block. Check BEFORE
  // inserting (so the new row can't match itself), then warn — never block. The save still happens;
  // a manual reconciliation is sometimes legitimate, so the admin decides.
  const conflicts = checkOut && type === "booking" ? findConflicts(db, date, checkOut) : [];
  const result = await runMutation({ audit: ["create", "booking"] }, () => {
    createBooking(db, {
      guest,
      date,
      checkOut,
      currency,
      amount: toCents(amount),
      type,
      channel,
      manualRate,
      coHostUserId,
    });
  });
  return result.ok && conflicts.length ? { ...result, warning: conflicts } : result;
}, "addBooking");

// Co-hosts (role "user") — a booking's commission accrues to the chosen co-host.
const coHostsQuery = query(async () => {
  "use server";
  await requireUser();
  return listUsers(db)
    .filter((u) => u.role === "user" && u.status === "active")
    .map((u) => ({ id: u.id, name: u.name }));
}, "bookingCoHosts");

const canManageQuery = query(async () => {
  "use server";
  const me = await currentUser();
  return me?.role === "superadmin";
}, "bookingsCanManage");

const editBooking = action(async (form: FormData) => {
  "use server";
  await requireSuperadmin();
  const id = Number(form.get("id"));
  const guest = String(form.get("guest") ?? "");
  const date = String(form.get("date") ?? "") || undefined;
  const channelRaw = form.get("channel");
  const channel = channelRaw === "booking" || channelRaw === "airbnb" ? channelRaw : "direct";
  const checkOut = String(form.get("checkOut") ?? "") || null;
  const coHostUserId = Number(form.get("coHostUserId")) || null;
  return runMutation({ audit: ["update", "booking"] }, () => {
    editBookingDetails(db, id, { guest, date, channel, checkOut, coHostUserId });
  });
}, "editBooking");

const removeBooking = action(async (form: FormData) => {
  "use server";
  await requireSuperadmin();
  const id = Number(form.get("id"));
  return runMutation({ audit: ["delete", "booking"] }, () => {
    deleteBooking(db, id);
  });
}, "removeBooking");

const bulkRemoveBookings = action(async (form: FormData) => {
  "use server";
  await requireSuperadmin();
  const ids = form.getAll("id").map(Number);
  return runMutation({ audit: ["delete", "booking"] }, () => {
    deleteBookings(db, ids);
  });
}, "bulkRemoveBookings");

const accruedQuery = query(async () => {
  "use server";
  await requireUser();
  return accruedCommissionEur(db);
}, "accruedCommission");

// Each booking's cash receipt (id + date) — drives the Paid/Pending chip, gates "Registrar cobro",
// and feeds the superadmin "edit cobro date" modal.
const paymentsQuery = query(async () => {
  "use server";
  await requireUser();
  return bookingPayments(db);
}, "bookingsPayments");

// Partners for the "who received the money?" select, plus whether this user may register cobros.
// Registering moves the Caja balance, so it's gated by managePartnersCash — same as Caja itself.
const cashQuery = query(async () => {
  "use server";
  const me = await currentUser();
  const canCash = !!me && can(me.role, "managePartnersCash");
  return { canCash, partners: canCash ? listPartners(db) : [] };
}, "bookingsCash");

const registerPayment = action(async (form: FormData) => {
  "use server";
  const me = await currentUser();
  if (!me || !can(me.role, "managePartnersCash")) return { error: "forbidden" };
  const bookingId = Number(form.get("bookingId"));
  const partnerId = Number(form.get("partnerId"));
  const date = String(form.get("date") ?? "");
  const amountRaw = Number(form.get("amount"));
  const amountEur = Number.isFinite(amountRaw) && amountRaw > 0 ? toCents(amountRaw) : undefined;
  if (!bookingId || !partnerId || !date) return { error: "invalid" };
  return runMutation({ audit: ["create", "cashEntry"] }, () => {
    registerBookingPayment(db, { bookingId, partnerId, date, amountEur });
  });
}, "registerPayment");

// Correct a registered cobro's date — superadmin only (editing frozen-ish financial records).
const editPayment = action(async (form: FormData) => {
  "use server";
  await requireSuperadmin();
  const id = Number(form.get("id"));
  const date = String(form.get("date") ?? "");
  if (!id || !date) return { error: "invalid" };
  return runMutation({ audit: ["update", "cashEntry"] }, () => {
    editCashEntryDate(db, id, date);
  });
}, "editPayment");

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
  const coHosts = createAsync(() => coHostsQuery(), { initialValue: [] });
  const defaultCoHost = () => coHosts()[0]?.id;
  const submission = useSubmission(addBooking);
  const confirm = useConfirm();
  const canManage = createAsync(() => canManageQuery(), { initialValue: false });
  const cash = createAsync(() => cashQuery(), { initialValue: { canCash: false, partners: [] } });
  const payments = createAsync(() => paymentsQuery(), { initialValue: [] });
  const paidSet = createMemo(() => new Set(payments().map((p) => p.bookingId)));
  const paymentByBooking = createMemo(() => new Map(payments().map((p) => [p.bookingId, p])));
  const editing = useSubmission(editBooking);
  const removing = useSubmission(removeBooking);
  const registering = useSubmission(registerPayment);
  const editingPay = useSubmission(editPayment);
  const bulkRemoving = useSubmission(bulkRemoveBookings);
  const money = (cents: number) => formatMoney(cents, locale());
  const channelLabel = (c: BookingChannel) => t(bookingChannelKey[c]);
  // Translate a returned error code to a localized message; raw codes never render.
  const errMsg = (code: string) => t(`bookings.err_${code}` as Parameters<typeof t>[0]) as string;
  const form = createEntityForm(submission, () => {
    setDate("");
    setAmount(0);
    setCurrency("EUR");
  });
  // Conflicts ride on a successful add result; narrow the ok|error union to read them.
  const addWarnings = (): Conflict[] | undefined => {
    const r = submission.result;
    return r && "warning" in r ? (r.warning as Conflict[] | undefined) : undefined;
  };

  // The booking whose edit modal is open (null = closed); holds the row so the form pre-fills.
  const [editTarget, setEditTarget] = createSignal<Booking | null>(null);
  createEffect(() => {
    if (editing.result?.ok) setEditTarget(null);
  });

  // The booking whose "registrar cobro" modal is open (null = closed).
  const [payTarget, setPayTarget] = createSignal<Booking | null>(null);
  createEffect(() => {
    if (registering.result?.ok) setPayTarget(null);
  });

  // The booking whose "edit cobro date" modal is open (superadmin only).
  const [payEditTarget, setPayEditTarget] = createSignal<Booking | null>(null);
  createEffect(() => {
    if (editingPay.result?.ok) setPayEditTarget(null);
  });

  // Bulk selection — a Set of booking ids, scoped to the rows currently listed.
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allSelected = () => bookings().length > 0 && bookings().every((b) => selected().has(b.id));
  const toggleAll = () =>
    setSelected(allSelected() ? new Set<number>() : new Set(bookings().map((b) => b.id)));
  // Drop the selection once a bulk delete lands so the (now-gone) ids don't linger.
  createEffect(() => {
    if (bulkRemoving.result?.ok) setSelected(new Set<number>());
  });

  // The actions ⋯ column shows for superadmins (edit/delete) OR cash managers (registrar cobro).
  const showActions = () => canManage() || cash().canCash;
  // 6 data cols + the superadmin bulk-check col + the actions col when either gate is open.
  const cols = () => 6 + (canManage() ? 1 : 0) + (showActions() ? 1 : 0);

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
              <option value="damage">{t("bookings.type_damage")}</option>
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
          <Show when={coHosts().length > 0}>
            <label class="tb-field">
              <span>{t("commissions.coHost")}</span>
              <select name="coHostUserId">
                <For each={coHosts()}>
                  {(c) => (
                    <option value={c.id} selected={c.id === defaultCoHost()}>
                      {c.name}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
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
        {/* CA-86: non-blocking double-booking warning. The save succeeded; this just flags the
            overlap so the admin can reconcile (e.g. cancel the OTA side) if it wasn't intentional. */}
        <Show when={addWarnings()?.length}>
          <div class="alert alert-warn" role="alert">
            <strong>{t("bookings.conflictWarning")}</strong>
            <ul style={{ margin: "6px 0 0", "padding-left": "1.1rem" }}>
              <For each={addWarnings()}>
                {(c) => (
                  <li>
                    <span class={`chan chan-${c.channel}`}>
                      {channelLabel(c.channel as BookingChannel)}
                    </span>{" "}
                    {c.start} → {c.end}
                    {c.label ? ` · ${c.label}` : ""}
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </Modal>

      {/* Edit modal — only the non-financial fields (guest/channel/check-out); the FX snapshot
          is immutable, so amount/currency/date are intentionally not editable. */}
      <Modal
        open={editTarget() != null}
        onClose={() => setEditTarget(null)}
        title={t("bookings.editTitle")}
      >
        <Show when={editTarget()}>
          {(b) => (
            <form action={editBooking} method="post" class="toolbar entry-form">
              <input type="hidden" name="id" value={b().id} />
              <label class="tb-field tb-grow">
                <span>{t("bookings.guest")}</span>
                <input name="guest" required value={b().guest} />
              </label>
              <label class="tb-field">
                <span>{t("bookings.checkIn")}</span>
                <input type="date" name="date" required value={b().date} />
              </label>
              <label class="tb-field">
                <span>{t("bookings.checkOut")}</span>
                <input type="date" name="checkOut" min={b().date} value={b().checkOut ?? ""} />
              </label>
              <label class="tb-field">
                <span>{t("bookings.channel")}</span>
                <select name="channel" value={b().channel}>
                  <option value="direct">{t("bookings.channel_direct")}</option>
                  <option value="booking">{t("bookings.channel_booking")}</option>
                  <option value="airbnb">{t("bookings.channel_airbnb")}</option>
                </select>
              </label>
              <Show when={coHosts().length > 0}>
                <label class="tb-field">
                  <span>{t("commissions.coHost")}</span>
                  <select name="coHostUserId">
                    <For each={coHosts()}>
                      {(c) => (
                        <option value={c.id} selected={c.id === b().coHostUserId}>
                          {c.name}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </Show>
              <button type="submit" disabled={editing.pending}>
                {editing.pending ? t("common.saving") : t("common.save")}
              </button>
              <Show when={editing.result?.error}>
                {(err) => (
                  <p class="alert alert-error" role="alert">
                    {errMsg(err())}
                  </p>
                )}
              </Show>
            </form>
          )}
        </Show>
      </Modal>

      {/* Registrar cobro — books the rent as a Caja "income" movement linked to this booking.
          Bookings stay the income source of truth; this only records which partner pocketed it. */}
      <Modal
        open={payTarget() != null}
        onClose={() => setPayTarget(null)}
        title={t("bookings.payTitle")}
      >
        <Show when={payTarget()}>
          {(b) => (
            <form action={registerPayment} method="post" class="toolbar entry-form">
              <input type="hidden" name="bookingId" value={b().id} />
              <p class="sub" style={{ "flex-basis": "100%" }}>
                {t("bookings.payHint")}
              </p>
              <label class="tb-field tb-grow">
                <span>{t("bookings.receivedBy")}</span>
                <select name="partnerId" required>
                  <For each={cash().partners}>
                    {(pt) => <option value={pt.id}>{pt.name}</option>}
                  </For>
                </select>
              </label>
              <label class="tb-field">
                <span>{t("bookings.payDate")}</span>
                <input type="date" name="date" required value={todayLocal()} />
              </label>
              <label class="tb-field">
                <span>{t("bookings.payAmount")}</span>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0"
                  value={(b().amountEur / 100).toFixed(2)}
                />
              </label>
              <button type="submit" disabled={registering.pending}>
                {registering.pending ? t("common.saving") : t("bookings.register")}
              </button>
              <Show when={registering.result?.error}>
                {(err) => (
                  <p class="alert alert-error" role="alert">
                    {errMsg(err())}
                  </p>
                )}
              </Show>
            </form>
          )}
        </Show>
      </Modal>

      {/* Edit cobro date — superadmin correction of an already-registered receipt. Date only;
          amount/partner are fixed at registration (delete + re-register to change those). */}
      <Modal
        open={payEditTarget() != null}
        onClose={() => setPayEditTarget(null)}
        title={t("bookings.editPayTitle")}
      >
        <Show when={payEditTarget()}>
          {(b) => {
            const pay = () => paymentByBooking().get(b().id);
            return (
              <form action={editPayment} method="post" class="toolbar entry-form">
                <input type="hidden" name="id" value={pay()?.id} />
                <label class="tb-field">
                  <span>{t("bookings.payDate")}</span>
                  <input type="date" name="date" required value={pay()?.date ?? ""} />
                </label>
                <button type="submit" disabled={editingPay.pending}>
                  {editingPay.pending ? t("common.saving") : t("common.save")}
                </button>
                <Show when={editingPay.result?.error}>
                  {(err) => (
                    <p class="alert alert-error" role="alert">
                      {errMsg(err())}
                    </p>
                  )}
                </Show>
              </form>
            );
          }}
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

      {/* Bulk action bar — superadmin-only, appears only with a live selection (separate from the
          GET filter form above, which can't nest a POST). */}
      <Show when={canManage() && selected().size > 0}>
        <div class="toolbar filter">
          <span class="toolbar-label">
            {selected().size} {t("bookings.selected")}
          </span>
          <form action={bulkRemoveBookings} method="post">
            <For each={[...selected()]}>{(id) => <input type="hidden" name="id" value={id} />}</For>
            <button
              type="submit"
              class="btn-ghost"
              disabled={bulkRemoving.pending}
              onClick={async (e) => {
                e.preventDefault();
                const f = e.currentTarget.form;
                if (await confirm({ message: t("bookings.confirmDeleteSelected"), danger: true })) {
                  f?.requestSubmit();
                }
              }}
            >
              {t("bookings.deleteSelected")}
            </button>
          </form>
        </div>
      </Show>

      <div class="panel table-scroll">
        <table class="cards">
          <thead>
            <tr>
              <Show when={canManage()}>
                <th class="col-check">
                  <input
                    type="checkbox"
                    checked={allSelected()}
                    onChange={toggleAll}
                    aria-label={t("common.actions")}
                  />
                </th>
              </Show>
              <th>{t("bookings.checkIn")}</th>
              <th>{t("bookings.checkOut")}</th>
              <th>{t("bookings.guest")}</th>
              <th>{t("bookings.channel")}</th>
              <th class="num">EUR</th>
              <th class="num">{t("bookings.commission")}</th>
              <Show when={showActions()}>
                <th class="col-actions">
                  <span class="sr-only">{t("common.actions")}</span>
                </th>
              </Show>
            </tr>
          </thead>
          <tbody>
            <For each={bookings()} fallback={<EmptyRow cols={cols()} text={t("bookings.empty")} />}>
              {(b) => (
                <tr>
                  <Show when={canManage()}>
                    <td class="col-check">
                      <input
                        type="checkbox"
                        checked={selected().has(b.id)}
                        onChange={() => toggle(b.id)}
                        aria-label={b.guest}
                      />
                    </td>
                  </Show>
                  <td>{b.date}</td>
                  <td data-label={t("bookings.checkOut")}>{b.checkOut ?? "—"}</td>
                  <td data-label={t("bookings.guest")}>
                    {b.guest}{" "}
                    {/* Every booking row is real money in (rent, cancellation fee, damage payment),
                        so all carry a Cobrado/Pendiente state and can be collected into Caja. */}
                    <span class={`chip ${paidSet().has(b.id) ? "chip-pos" : "chip-pending"}`}>
                      {paidSet().has(b.id) ? `✓ ${t("bookings.paid")}` : t("bookings.pending")}
                    </span>
                  </td>
                  <td data-label={t("bookings.channel")}>
                    <span class={`chan chan-${b.channel}`}>{channelLabel(b.channel)}</span>
                  </td>
                  <td class="num" data-label="EUR">
                    {money(b.amountEur)}
                  </td>
                  <td class="num" data-label={t("bookings.commission")}>
                    {money(b.commissionEur)}
                  </td>
                  <Show when={showActions()}>
                    {/* Row action menu (⋯): registrar cobro (cash managers) + edit/delete
                        (superadmin). Native Popover API → top layer, never clipped by the table. */}
                    <td class="col-actions" data-label={t("common.actions")}>
                      <button
                        type="button"
                        class="row-menu-trigger"
                        aria-label={t("common.actions")}
                        popovertarget={`bk-menu-${b.id}`}
                        style={{ "anchor-name": `--bk-menu-${b.id}` }}
                      >
                        ⋯
                      </button>
                      <div
                        id={`bk-menu-${b.id}`}
                        popover="auto"
                        class="menu-pop"
                        style={{ "position-anchor": `--bk-menu-${b.id}` }}
                      >
                        <Show when={cash().canCash && !paidSet().has(b.id)}>
                          <button
                            type="button"
                            class="menu-item"
                            onClick={(ev) => {
                              registering.clear?.(); // fresh modal — no stale error banner
                              setPayTarget(b);
                              closePopover(ev.currentTarget);
                            }}
                          >
                            {t("bookings.registerPayment")}
                          </button>
                        </Show>
                        <Show when={canManage()}>
                          <Show when={paidSet().has(b.id)}>
                            <button
                              type="button"
                              class="menu-item"
                              onClick={(ev) => {
                                editingPay.clear?.(); // fresh modal — no stale error banner
                                setPayEditTarget(b);
                                closePopover(ev.currentTarget);
                              }}
                            >
                              {t("bookings.editPayment")}
                            </button>
                          </Show>
                          <button
                            type="button"
                            class="menu-item"
                            onClick={(ev) => {
                              editing.clear?.(); // fresh modal — no stale error banner
                              setEditTarget(b);
                              closePopover(ev.currentTarget);
                            }}
                          >
                            {t("common.edit")}
                          </button>
                          <form action={removeBooking} method="post">
                            <input type="hidden" name="id" value={b.id} />
                            <button
                              type="submit"
                              class="menu-item"
                              onClick={async (ev) => {
                                ev.preventDefault();
                                const button = ev.currentTarget;
                                const f = button.form;
                                if (
                                  await confirm({
                                    message: t("bookings.confirmDelete"),
                                    danger: true,
                                  })
                                ) {
                                  closePopover(button);
                                  f?.requestSubmit();
                                }
                              }}
                            >
                              {t("bookings.delete")}
                            </button>
                          </form>
                        </Show>
                      </div>
                    </td>
                  </Show>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      <Show when={removing.result?.error ?? bulkRemoving.result?.error}>
        {(err) => (
          <p class="alert alert-error" role="alert">
            {errMsg(err())}
          </p>
        )}
      </Show>

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
