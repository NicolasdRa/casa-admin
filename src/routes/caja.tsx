import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { Modal } from "~/components/Modal";
import { createCashEntry, deleteCashEntry, listCashLedger } from "~/db/cash";
import { db } from "~/db/index";
import { listPartners } from "~/db/partners";
import { partnerStatements } from "~/db/statements";
import { useI18n } from "~/lib/i18n";
import { formatMoney, toCents } from "~/lib/money";
import { can } from "~/lib/permissions";
import { currentUser, recordAudit } from "~/lib/session";

async function requireCash() {
  const me = await currentUser();
  if (!me || !can(me.role, "managePartnersCash")) throw redirect("/");
  return me;
}

// Today in the *local* calendar (not UTC) — the manager logs the day the cash actually moved.
const todayLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const ledgerQuery = query(async () => {
  "use server";
  await requireCash();
  return listCashLedger(db);
}, "cashLedger");

const partnersQuery = query(async () => {
  "use server";
  await requireCash();
  return listPartners(db);
}, "cashPartners");

const statementsQuery = query(async () => {
  "use server";
  await requireCash();
  return partnerStatements(db);
}, "partnerStatements");

const addCashEntry = action(async (form: FormData) => {
  "use server";
  await requireCash();
  const date = String(form.get("date") ?? "");
  const partnerId = Number(form.get("partnerId"));
  const concept = String(form.get("concept") ?? "").trim();
  const typeRaw = String(form.get("type") ?? "");
  const type = typeRaw === "withdrawal" || typeRaw === "allocation" ? typeRaw : "contribution";
  const amount = Number(form.get("amount"));
  if (!date || !partnerId || !concept || !Number.isFinite(amount) || amount <= 0) {
    return { error: "invalid" };
  }
  const cents = toCents(amount);
  createCashEntry(db, {
    date,
    partnerId,
    concept,
    type,
    amountEur: type === "withdrawal" ? -cents : cents,
  });
  await recordAudit("create", "cashEntry");
  return { ok: true };
}, "addCashEntry");

const removeCashEntry = action(async (form: FormData) => {
  "use server";
  await requireCash();
  deleteCashEntry(db, Number(form.get("id")));
  await recordAudit("delete", "cashEntry");
  return { ok: true };
}, "removeCashEntry");

export default function Caja() {
  const { t, locale } = useI18n();
  const ledger = createAsync(() => ledgerQuery(), { initialValue: [] });
  const partners = createAsync(() => partnersQuery(), { initialValue: [] });
  const statements = createAsync(() => statementsQuery(), { initialValue: [] });
  const adding = useSubmission(addCashEntry);
  const removing = useSubmission(removeCashEntry);
  const money = (c: number) => formatMoney(c, locale());
  const sign = (c: number) => (c < 0 ? "num neg" : c > 0 ? "num pos" : "num");
  const partnerName = createMemo(() => new Map(partners().map((p) => [p.id, p.name])));
  // running balance is computed chronologically, displayed newest-first
  const ledgerDesc = createMemo(() => ledger().slice().reverse());
  // Column totals reconcile the split — settle should net to ~0 and cashAccount to the box balance.
  const totals = createMemo(() => {
    const rows = statements();
    const sum = (f: (s: (typeof rows)[number]) => number) => rows.reduce((a, s) => a + f(s), 0);
    return {
      incomeShare: sum((s) => s.incomeShare),
      commissionShare: sum((s) => s.commissionShare),
      expenseShare: sum((s) => s.expenseShare),
      fronted: sum((s) => s.fronted),
      cashAccount: sum((s) => s.cashAccount),
      settle: sum((s) => s.settle),
    };
  });
  const [formOpen, setFormOpen] = createSignal(false);
  let formEl: HTMLFormElement | undefined;
  createEffect(() => {
    if (adding.result?.ok) formEl?.reset();
  });

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("caja.title")}</h1>
        </div>
        <div class="page-head-actions">
          <button
            type="button"
            onClick={() => {
              adding.clear?.();
              setFormOpen(true);
            }}
          >
            + {t("caja.add")}
          </button>
        </div>
      </header>

      <Modal open={formOpen()} onClose={() => setFormOpen(false)} title={t("caja.add")}>
        <form ref={formEl} action={addCashEntry} method="post" class="toolbar entry-form">
          <label class="tb-field">
            <span>{t("common.date")}</span>
            <input type="date" name="date" required value={todayLocal()} />
          </label>
          <label class="tb-field">
            <span>{t("caja.partner")}</span>
            <select name="partnerId" required>
              <For each={partners()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
            </select>
          </label>
          <label class="tb-field">
            <span>{t("caja.type")}</span>
            <select name="type">
              <option value="contribution">{t("caja.contribution")}</option>
              <option value="withdrawal">{t("caja.withdrawal")}</option>
              <option value="allocation">{t("caja.allocation")}</option>
            </select>
          </label>
          <label class="tb-field tb-grow">
            <span>{t("caja.concept")}</span>
            <input name="concept" required />
          </label>
          <label class="tb-field">
            <span>{t("common.amount")}</span>
            <input type="number" name="amount" step="0.01" min="0" required />
          </label>
          <button type="submit" disabled={adding.pending}>
            {adding.pending ? t("common.saving") : t("common.save")}
          </button>
        </form>
        <Show when={adding.result?.ok}>
          <p class="alert alert-success" role="status">
            {t("common.saved")}
          </p>
        </Show>
        <Show when={adding.result?.error}>
          <p class="alert alert-error" role="alert">
            {t("caja.err_invalid")}
          </p>
        </Show>
      </Modal>

      <section class="panel">
        <div class="panel-head">
          <h2>{t("caja.statements")}</h2>
        </div>
        <div class="table-scroll">
          <table class="cards">
            <thead>
              <tr>
                <th>{t("caja.partner")}</th>
                <th class="num">{t("caja.income")}</th>
                <th class="num">{t("caja.commission")}</th>
                <th class="num">{t("caja.expenseShare")}</th>
                <th class="num">{t("caja.fronted")}</th>
                <th class="num">{t("caja.cashAccount")}</th>
                <th class="num">{t("caja.settle")}</th>
              </tr>
            </thead>
            <tbody>
              <For
                each={statements()}
                fallback={
                  <tr>
                    <td colspan="7" class="note">
                      {t("caja.noStatements")}
                    </td>
                  </tr>
                }
              >
                {(s) => (
                  <tr>
                    <td>{s.name}</td>
                    <td class="num" data-label={t("caja.income")}>
                      {money(s.incomeShare)}
                    </td>
                    <td class="num" data-label={t("caja.commission")}>
                      {money(s.commissionShare)}
                    </td>
                    <td class="num" data-label={t("caja.expenseShare")}>
                      {money(s.expenseShare)}
                    </td>
                    <td class="num" data-label={t("caja.fronted")}>
                      {money(s.fronted)}
                    </td>
                    <td class={sign(s.cashAccount)} data-label={t("caja.cashAccount")}>
                      {money(s.cashAccount)}
                    </td>
                    <td class={sign(s.settle)} data-label={t("caja.settle")}>
                      {money(s.settle)}
                    </td>
                  </tr>
                )}
              </For>
              <Show when={statements().length > 0}>
                <tr class="total">
                  <td>{t("caja.total")}</td>
                  <td class="num" data-label={t("caja.income")}>
                    {money(totals().incomeShare)}
                  </td>
                  <td class="num" data-label={t("caja.commission")}>
                    {money(totals().commissionShare)}
                  </td>
                  <td class="num" data-label={t("caja.expenseShare")}>
                    {money(totals().expenseShare)}
                  </td>
                  <td class="num" data-label={t("caja.fronted")}>
                    {money(totals().fronted)}
                  </td>
                  <td class={sign(totals().cashAccount)} data-label={t("caja.cashAccount")}>
                    {money(totals().cashAccount)}
                  </td>
                  <td class={sign(totals().settle)} data-label={t("caja.settle")}>
                    {money(totals().settle)}
                  </td>
                </tr>
              </Show>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>{t("caja.ledger")}</h2>
        </div>
        <div class="table-scroll">
          <table class="cards">
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("caja.partner")}</th>
                <th>{t("caja.concept")}</th>
                <th class="num">EUR</th>
                <th class="num">{t("caja.balance")}</th>
                <th class="col-actions">
                  <span class="sr-only">{t("common.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For
                each={ledgerDesc()}
                fallback={
                  <tr>
                    <td colspan="6" class="note">
                      {t("caja.empty")}
                    </td>
                  </tr>
                }
              >
                {(e) => (
                  <tr>
                    <td>{e.date}</td>
                    <td data-label={t("caja.partner")}>
                      {partnerName().get(e.partnerId) ?? e.partnerId}
                    </td>
                    <td data-label={t("caja.concept")}>{e.concept}</td>
                    <td class={sign(e.amountEur)} data-label="EUR">
                      {money(e.amountEur)}
                    </td>
                    <td class={sign(e.runningBalance)} data-label={t("caja.balance")}>
                      {money(e.runningBalance)}
                    </td>
                    <td class="col-actions" data-label={t("common.actions")}>
                      <form action={removeCashEntry} method="post">
                        <input type="hidden" name="id" value={e.id} />
                        <button
                          type="submit"
                          class="btn-ghost"
                          disabled={removing.pending}
                          onClick={(ev) => {
                            if (!confirm(t("caja.confirmDelete"))) ev.preventDefault();
                          }}
                        >
                          {t("caja.delete")}
                        </button>
                      </form>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
