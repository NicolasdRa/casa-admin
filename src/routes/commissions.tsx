import {
  action,
  createAsync,
  query,
  redirect,
  useSearchParams,
  useSubmission,
} from "@solidjs/router";
import { createEffect, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { useConfirm } from "~/components/ConfirmProvider";
import { Modal } from "~/components/Modal";
import { listBookings } from "~/db/bookings";
import {
  commissionBalance,
  createCommissionSettlement,
  deleteCommissionSettlement,
  listCommissionSettlements,
  updateCommissionSettlement,
} from "~/db/commission";
import { db } from "~/db/index";
import { listUsers } from "~/db/users";
import { createEntityForm } from "~/lib/createEntityForm";
import { useI18n } from "~/lib/i18n";
import { formatMoney, toCents } from "~/lib/money";
import { runMutation } from "~/lib/mutation";
import { can } from "~/lib/permissions";
import { currentUser, requireUser } from "~/lib/session";

interface Filter {
  year?: string;
  from?: string;
  to?: string;
  coHostUserId?: number;
}

// Settling commission moves money against a frozen accrual, so it's superadmin-only; the balance,
// the per-booking breakdown and the history stay visible to every signed-in user (the co-host
// needs to see what they're owed).
async function requireSuperadmin() {
  const me = await currentUser();
  if (!me || !can(me.role, "settleCommission")) throw redirect("/");
  return me;
}

const commissionsQuery = query(async (filter: Filter) => {
  "use server";
  await requireUser();
  // Commission accrues only on `booking` rows; non-bookings carry 0, so >0 is the accrual set.
  const accruals = listBookings(db, filter).filter((b) => b.commissionEur > 0);
  const settlements = listCommissionSettlements(db, filter);
  return {
    balance: commissionBalance(db),
    accruals,
    accruedInFilter: accruals.reduce((s, b) => s + b.commissionEur, 0),
    settlements,
    settledInFilter: settlements.reduce((s, r) => s + r.amountEur, 0),
  };
}, "commissions");

const canManageQuery = query(async () => {
  "use server";
  const me = await currentUser();
  return me ? can(me.role, "settleCommission") : false;
}, "commissionsCanManage");

// Co-hosts are the role "user" accounts — the people a commission is owed to and settled with.
const coHostsQuery = query(async () => {
  "use server";
  await requireUser();
  return listUsers(db)
    .filter((u) => u.role === "user" && u.status === "active")
    .map((u) => ({ id: u.id, name: u.name }));
}, "commissionCoHosts");

const settle = action(async (form: FormData) => {
  "use server";
  await requireSuperadmin();
  const date = String(form.get("date") ?? "");
  const amount = Number(form.get("amount"));
  const note = String(form.get("note") ?? "").trim() || undefined;
  const coHostUserId = Number(form.get("coHostUserId")) || null;
  if (!date || !Number.isFinite(amount) || amount <= 0) return { error: "amountInvalid" };
  return runMutation({ audit: ["create", "commission_settlement"] }, () => {
    createCommissionSettlement(db, { date, amountEur: toCents(amount), note, coHostUserId });
  });
}, "settleCommission");

// Correcting a frozen settlement is superadmin-only, same as recording one.
const editSettlement = action(async (form: FormData) => {
  "use server";
  await requireSuperadmin();
  const id = Number(form.get("id"));
  const date = String(form.get("date") ?? "");
  const amount = Number(form.get("amount"));
  const note = String(form.get("note") ?? "").trim() || undefined;
  const coHostUserId = Number(form.get("coHostUserId")) || null;
  if (!id || !date || !Number.isFinite(amount) || amount <= 0) return { error: "amountInvalid" };
  return runMutation({ audit: ["update", "commission_settlement"] }, () => {
    updateCommissionSettlement(db, id, { date, amountEur: toCents(amount), note, coHostUserId });
  });
}, "editCommissionSettlement");

const removeSettlement = action(async (form: FormData) => {
  "use server";
  await requireSuperadmin();
  const id = Number(form.get("id"));
  return runMutation({ audit: ["delete", "commission_settlement"] }, () => {
    deleteCommissionSettlement(db, id);
  });
}, "removeCommissionSettlement");

// Dismiss the native popover a menu button lives in — top-layer menus don't close on inner clicks.
function closePopover(el: HTMLElement) {
  el.closest<HTMLElement>("[popover]")?.hidePopover();
}

export default function Commissions() {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const p = (k: "year" | "from" | "to") => {
    const v = params[k];
    return typeof v === "string" && v ? v : undefined;
  };
  // Selected co-host filter (URL param "coHost"); undefined = all co-hosts.
  const coHostParam = () => Number(params.coHost) || undefined;
  // Active tab in the URL so it survives the filter form's GET navigation.
  const tab = () => (params.tab === "history" ? "history" : "accruals");
  const data = createAsync(
    () =>
      commissionsQuery({
        year: p("year"),
        from: p("from"),
        to: p("to"),
        coHostUserId: coHostParam(),
      }),
    {
      initialValue: {
        balance: { accrued: 0, settled: 0, owed: 0 },
        accruals: [],
        accruedInFilter: 0,
        settlements: [],
        settledInFilter: 0,
      },
    },
  );
  const confirm = useConfirm();
  const canManage = createAsync(() => canManageQuery(), { initialValue: false });
  const coHosts = createAsync(() => coHostsQuery(), { initialValue: [] });
  // Default the settle form to the sole co-host (Fernando now); a real choice once there are several.
  const defaultCoHost = () => coHosts()[0]?.id;
  const coHostName = (id: number | null) => coHosts().find((c) => c.id === id)?.name ?? "—";
  const submission = useSubmission(settle);
  const settleForm = createEntityForm(submission);
  const editing = useSubmission(editSettlement);
  const removing = useSubmission(removeSettlement);
  const money = (c: number) => formatMoney(c, locale());
  const today = new Date().toISOString().slice(0, 10);
  // The settlement whose edit modal is open (null = closed); holds the row so the form pre-fills.
  const [editTarget, setEditTarget] = createSignal<{
    id: number;
    date: string;
    amountEur: number;
    note: string | null;
    coHostUserId: number | null;
  } | null>(null);
  createEffect(() => {
    if (editing.result?.ok) setEditTarget(null); // close once the save lands
  });

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("commissions.title")}</h1>
          <p class="sub">{t("commissions.subtitle")}</p>
        </div>
        <Show when={canManage()}>
          <div class="page-head-actions">
            <button type="button" onClick={settleForm.openForm}>
              + {t("commissions.settleTitle")}
            </button>
          </div>
        </Show>
      </header>

      {/* Standing commission balance — global / all-time (NOT scoped by the filter below, which only
          narrows the detail tables): accrued vs settled, and what remains to settle (owed). */}
      <section class="panel stats">
        <div class="stat">
          <div class="k">{t("commissions.accrued")}</div>
          <div class="v">{money(data().balance.accrued)} €</div>
        </div>
        <div class="stat">
          <div class="k">{t("commissions.settled")}</div>
          <div class="v">{money(data().balance.settled)} €</div>
        </div>
        <div class="stat">
          <div class="k">{t("commissions.owed")}</div>
          <div class="v">{money(data().balance.owed)} €</div>
        </div>
      </section>

      {/* Shared filter — applies to BOTH tabs. Hidden `tab` keeps the active tab across submit. */}
      <form method="get" class="toolbar filter">
        <span class="toolbar-label">{t("commissions.filter")}</span>
        <input type="hidden" name="tab" value={tab()} />
        <input name="year" placeholder={t("commissions.year")} value={p("year") ?? ""} size="6" />
        <input type="date" name="from" value={p("from") ?? ""} title={t("commissions.from")} />
        <input type="date" name="to" value={p("to") ?? ""} title={t("commissions.to")} />
        <select name="coHost" title={t("commissions.coHost")}>
          <option value="">{t("commissions.allCoHosts")}</option>
          <For each={coHosts()}>
            {(c) => (
              <option value={c.id} selected={c.id === coHostParam()}>
                {c.name}
              </option>
            )}
          </For>
        </select>
        <button type="submit" class="btn-ghost">
          {t("commissions.filter")}
        </button>
      </form>

      {/* Tabs — the two breakdowns; both honour the filter above. */}
      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="tab-btn"
          classList={{ "is-active": tab() === "accruals" }}
          aria-selected={tab() === "accruals"}
          onClick={() => setParams({ tab: "accruals" })}
        >
          {t("commissions.accruals")}
        </button>
        <button
          type="button"
          role="tab"
          class="tab-btn"
          classList={{ "is-active": tab() === "history" }}
          aria-selected={tab() === "history"}
          onClick={() => setParams({ tab: "history" })}
        >
          {t("commissions.history")}
        </button>
      </div>

      {/* Accruals tab */}
      <Show when={tab() === "accruals"}>
        <section class="panel table-scroll">
          <table class="cards">
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("commissions.guest")}</th>
                <th>{t("commissions.coHost")}</th>
                <th class="num">{t("commissions.income")}</th>
                <th class="num">{t("commissions.commission")}</th>
              </tr>
            </thead>
            <tbody>
              <For
                each={data().accruals}
                fallback={
                  <tr>
                    <td colspan="5" class="note">
                      {t("commissions.noAccruals")}
                    </td>
                  </tr>
                }
              >
                {(b) => (
                  <tr>
                    <td>{b.date}</td>
                    <td data-label={t("commissions.guest")}>{b.guest}</td>
                    <td data-label={t("commissions.coHost")}>{coHostName(b.coHostUserId)}</td>
                    <td class="num" data-label={t("commissions.income")}>
                      {money(b.amountEur)}
                    </td>
                    <td class="num" data-label={t("commissions.commission")}>
                      {money(b.commissionEur)}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
            <Show when={data().accruals.length > 0}>
              <tfoot>
                <tr class="total">
                  <td colspan="4">{t("commissions.total")}</td>
                  <td class="num">{money(data().accruedInFilter)}</td>
                </tr>
              </tfoot>
            </Show>
          </table>
        </section>
      </Show>

      {/* History tab — visible to all so the co-host can audit payments. */}
      <Show when={tab() === "history"}>
        <section class="panel table-scroll">
          <Show when={editing.result?.ok || removing.result?.ok}>
            <p class="alert alert-success" role="status">
              {t("common.saved")}
            </p>
          </Show>
          <table class="cards">
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("commissions.coHost")}</th>
                <th>{t("commissions.note")}</th>
                <th class="num">{t("commissions.amount")}</th>
                <Show when={canManage()}>
                  <th class="col-actions">{t("common.actions")}</th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <For
                each={data().settlements}
                fallback={
                  <tr>
                    <td colspan={canManage() ? 5 : 4} class="note">
                      {t("commissions.noSettlements")}
                    </td>
                  </tr>
                }
              >
                {(s) => (
                  <tr>
                    <td>{s.date}</td>
                    <td data-label={t("commissions.coHost")}>{coHostName(s.coHostUserId)}</td>
                    <td data-label={t("commissions.note")}>{s.note ?? "—"}</td>
                    <td class="num" data-label={t("commissions.amount")}>
                      {money(s.amountEur)}
                    </td>
                    <Show when={canManage()}>
                      {/* Row action menu (⋯): edit + delete. Native Popover API → top layer, so
                        the dropdown is never clipped by the table; anchor ties it to this row. */}
                      <td class="col-actions" data-label={t("common.actions")}>
                        <button
                          type="button"
                          class="row-menu-trigger"
                          aria-label={t("common.actions")}
                          popovertarget={`com-menu-${s.id}`}
                          style={{ "anchor-name": `--com-menu-${s.id}` }}
                        >
                          ⋯
                        </button>
                        <div
                          id={`com-menu-${s.id}`}
                          popover="auto"
                          class="menu-pop"
                          style={{ "position-anchor": `--com-menu-${s.id}` }}
                        >
                          <button
                            type="button"
                            class="menu-item"
                            onClick={(ev) => {
                              editing.clear?.(); // fresh modal — no stale error banner
                              setEditTarget(s);
                              closePopover(ev.currentTarget);
                            }}
                          >
                            {t("common.edit")}
                          </button>
                          <form action={removeSettlement} method="post">
                            <input type="hidden" name="id" value={s.id} />
                            <button
                              type="submit"
                              class="menu-item"
                              onClick={async (ev) => {
                                ev.preventDefault();
                                const button = ev.currentTarget;
                                const f = button.form;
                                if (
                                  await confirm({
                                    message: t("commissions.confirmDelete"),
                                    danger: true,
                                  })
                                ) {
                                  closePopover(button);
                                  f?.requestSubmit();
                                }
                              }}
                            >
                              {t("commissions.delete")}
                            </button>
                          </form>
                        </div>
                      </td>
                    </Show>
                  </tr>
                )}
              </For>
            </tbody>
            <Show when={data().settlements.length > 0}>
              <tfoot>
                <tr class="total">
                  <td colspan="3">{t("commissions.total")}</td>
                  <td class="num">{money(data().settledInFilter)}</td>
                  <Show when={canManage()}>
                    <td class="col-actions" />
                  </Show>
                </tr>
              </tfoot>
            </Show>
          </table>
        </section>
      </Show>

      {/* Settle a new amount — superadmin only; opened from the header button. */}
      <Show when={canManage()}>
        <Modal
          open={settleForm.open()}
          onClose={() => settleForm.setOpen(false)}
          title={t("commissions.settleTitle")}
        >
          <form ref={settleForm.setRef} action={settle} method="post" class="toolbar entry-form">
            <label class="tb-field">
              <span>{t("common.date")}</span>
              <input type="date" name="date" required value={today} />
            </label>
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
            <label class="tb-field">
              <span>{t("commissions.amount")}</span>
              <input
                type="number"
                name="amount"
                step="0.01"
                min="0"
                required
                value={data().balance.owed > 0 ? (data().balance.owed / 100).toFixed(2) : ""}
              />
            </label>
            <label class="tb-field tb-grow">
              <span>{t("commissions.note")}</span>
              <input name="note" />
            </label>
            <button type="submit" disabled={submission.pending}>
              {submission.pending ? t("common.saving") : t("commissions.settle")}
            </button>
          </form>
          <Show when={submission.result?.ok}>
            <p class="alert alert-success" role="status">
              {t("commissions.saved")}
            </p>
          </Show>
          <Show when={submission.result?.error}>
            <p class="alert alert-error" role="alert">
              {t("commissions.amountInvalid")}
            </p>
          </Show>
        </Modal>
      </Show>

      {/* Edit a settlement — superadmin only; pre-filled from the chosen row. */}
      <Modal
        open={editTarget() != null}
        onClose={() => setEditTarget(null)}
        title={t("commissions.editTitle")}
      >
        <Show when={editTarget()}>
          {(s) => (
            <form action={editSettlement} method="post" class="toolbar entry-form">
              <input type="hidden" name="id" value={s().id} />
              <label class="tb-field">
                <span>{t("common.date")}</span>
                <input type="date" name="date" required value={s().date} />
              </label>
              <label class="tb-field">
                <span>{t("commissions.coHost")}</span>
                <select name="coHostUserId">
                  <For each={coHosts()}>
                    {(c) => (
                      <option value={c.id} selected={c.id === s().coHostUserId}>
                        {c.name}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <label class="tb-field">
                <span>{t("commissions.amount")}</span>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0"
                  required
                  value={(s().amountEur / 100).toFixed(2)}
                />
              </label>
              <label class="tb-field tb-grow">
                <span>{t("commissions.note")}</span>
                <input name="note" value={s().note ?? ""} />
              </label>
              <button type="submit" disabled={editing.pending}>
                {editing.pending ? t("common.saving") : t("common.save")}
              </button>
              <Show when={editing.result?.error}>
                <p class="alert alert-error" role="alert">
                  {t("commissions.amountInvalid")}
                </p>
              </Show>
            </form>
          )}
        </Show>
      </Modal>
    </AppShell>
  );
}
