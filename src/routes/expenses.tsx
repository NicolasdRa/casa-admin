import { A, action, createAsync, query, useSubmission } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { FxPreview } from "~/components/FxPreview";
import { Modal } from "~/components/Modal";
import { ensureFxRate } from "~/db/bna";
import {
  createExpense,
  expenseTotalsByUser,
  listCategories,
  listExpensesWithPayer,
  markExpenseReimbursed,
  receiptPlan,
  safeExt,
  setExpenseReceipt,
} from "~/db/expenses";
import { db } from "~/db/index";
import { settleExpense } from "~/db/settlement";
import { listSuppliers } from "~/db/suppliers";
import { listUsers } from "~/db/users";
import { useI18n } from "~/lib/i18n";
import { fromCents, toCents } from "~/lib/money";
import { can } from "~/lib/permissions";
import { recordAudit, requireUser } from "~/lib/session";

// Today in the *local* calendar (not UTC) — the manager enters expenses for the day they're living.
const todayLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Map a thrown message / internal code to a stable i18n suffix (expenses.err_*). Raw exception text
// never reaches the user: the action returns the suffix, the page translates it in the active locale.
function expenseErrorCode(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m.startsWith("No FX rate")) return "fxNoRate";
  if (m.startsWith("invalid date")) return "dateInvalid";
  if (m.startsWith("invalid amount")) return "amountInvalid";
  if (m.startsWith("invalid currency")) return "currencyInvalid";
  if (m.includes("pending co-host")) return "notReimbursable";
  if (m.includes("must be an owner")) return "reimburserNotOwner";
  if (m === "expense not found") return "notFound";
  return "generic";
}

const listExpensesQuery = query(async () => {
  "use server";
  await requireUser();
  return listExpensesWithPayer(db);
}, "expenses");

const listCategoriesQuery = query(async () => {
  "use server";
  await requireUser();
  return listCategories(db);
}, "categories");

const listSuppliersQuery = query(async () => {
  "use server";
  await requireUser();
  return listSuppliers(db);
}, "suppliers");

const userTotalsQuery = query(async () => {
  "use server";
  await requireUser();
  return expenseTotalsByUser(db);
}, "expenseUserTotals");

// Payer options + who I am (for the form default and to gate the reimburse action in the UI).
const meAndUsersQuery = query(async () => {
  "use server";
  const me = await requireUser();
  const users = listUsers(db).map((u) => ({ id: u.id, name: u.name }));
  return { meId: me.id, canReimburse: can(me.role, "reimburseExpenses"), users };
}, "expenseMeAndUsers");

const addExpense = action(async (form: FormData) => {
  "use server";
  const me = await requireUser();
  const date = String(form.get("date") ?? "");
  const currency = form.get("currency") === "ARS" ? "ARS" : "EUR";
  const amount = Number(form.get("amount"));
  const detail = String(form.get("detail") ?? "").trim() || undefined;
  const categoryRaw = form.get("categoryId");
  const categoryId = categoryRaw ? Number(categoryRaw) : undefined;
  const supplierRaw = form.get("supplierId");
  const supplierId = supplierRaw ? Number(supplierRaw) : undefined;
  // EX-8: whoever recorded it fronted it by default; an admin may attribute it to another user.
  const payerRaw = form.get("paidByUserId");
  const paidByUserId = payerRaw ? Number(payerRaw) : me.id;
  if (!date) return { error: "dateRequired" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amountInvalid" };
  try {
    // CA-89: convert pesos on the fly — if no BNA rate is stored for the date, fetch today's
    // quote from BNA before snapshotting. Backdated dates with no quote fall through to the
    // "no FX rate" error below (BNA only publishes the current day).
    const today = new Date().toISOString().slice(0, 10);
    await ensureFxRate(db, date, today);
    const row = createExpense(db, {
      date,
      currency,
      amount: toCents(amount),
      detail,
      categoryId,
      supplierId,
      paidByUserId,
    });
    // EX-6: store the receipt under a server-controlled filename (no user-controlled path).
    const receipt = form.get("receipt");
    if (receipt instanceof File && receipt.size > 0) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const dir = process.env.UPLOAD_DIR ?? "uploads";
      await mkdir(dir, { recursive: true });
      let data: Buffer = Buffer.from(await receipt.arrayBuffer());
      let ext = safeExt(receipt.name) || "bin";
      if (receiptPlan(receipt.type) === "webp") {
        // Downscale huge phone photos + normalise to webp; .rotate() honours EXIF orientation.
        // Optional optimisation: if sharp can't load (native libvips missing), store the original.
        try {
          const sharp = (await import("sharp")).default;
          data = await sharp(data)
            .rotate()
            .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
          ext = "webp";
        } catch (err) {
          console.error("sharp unavailable; storing original receipt:", (err as Error).message);
        }
      }
      const fname = `receipt-${row.id}.${ext}`;
      await writeFile(`${dir}/${fname}`, data);
      setExpenseReceipt(db, row.id, fname);
    }
    await recordAudit("create", "expense");
  } catch (e) {
    return { error: expenseErrorCode(e) };
  }
  return { ok: true };
}, "addExpense");

// EX-9: admin reimburses a co-host's pending expense; permission enforced server-side.
const reimburseExpense = action(async (form: FormData) => {
  "use server";
  const me = await requireUser();
  if (!can(me.role, "reimburseExpenses")) return { error: "forbidden" };
  const id = Number(form.get("id"));
  const today = new Date().toISOString().slice(0, 10);
  try {
    markExpenseReimbursed(db, id, me.id, today);
    await recordAudit("update", `expense:${id}`);
  } catch (e) {
    return { error: expenseErrorCode(e) };
  }
  return { ok: true };
}, "reimburseExpense");

// EX-12: repay an owner for an expense they fronted. Records the Caja withdrawal (dated today, when
// the cash leaves the box) and marks the expense reimbursed. Same permission gate as reimburse.
const settleExpenseAction = action(async (form: FormData) => {
  "use server";
  const me = await requireUser();
  if (!can(me.role, "reimburseExpenses")) return { error: "forbidden" };
  const id = Number(form.get("id"));
  const today = new Date().toISOString().slice(0, 10);
  const res = settleExpense(db, id, today);
  if (!res) return { error: "notSettleable" };
  await recordAudit("update", `expense:${id}`);
  return { ok: true };
}, "settleExpense");

export const route = {
  preload: () => {
    listExpensesQuery();
    listCategoriesQuery();
    listSuppliersQuery();
    userTotalsQuery();
    meAndUsersQuery();
  },
};

export default function Expenses() {
  const { t } = useI18n();
  const expenses = createAsync(() => listExpensesQuery(), { initialValue: [] });
  const categories = createAsync(() => listCategoriesQuery(), { initialValue: [] });
  const suppliers = createAsync(() => listSuppliersQuery(), { initialValue: [] });
  const userTotals = createAsync(() => userTotalsQuery(), { initialValue: [] });
  const me = createAsync(() => meAndUsersQuery(), {
    initialValue: { meId: 0, canReimburse: false, users: [] },
  });
  // Default the date to today — the heaviest path is entering today's spend; still freely editable.
  const [date, setDate] = createSignal(todayLocal());
  const [amount, setAmount] = createSignal(0);
  const [currency, setCurrency] = createSignal<"ARS" | "EUR">("EUR");
  // EX-10: filter the ledger by payer. "all" | "none" (unassigned) | user id.
  const [payerFilter, setPayerFilter] = createSignal<string>("all");
  // Add-expense lives in a modal so the ledger keeps the page; opened from the primary action.
  const [formOpen, setFormOpen] = createSignal(false);
  const submission = useSubmission(addExpense);
  const reSub = useSubmission(reimburseExpense);
  const settleSub = useSubmission(settleExpenseAction);
  const money = (cents: number) => fromCents(cents).toFixed(2);
  // Translate a returned error code to a human, localized message; raw codes never render.
  const errMsg = (code: string) => t(`expenses.err_${code}` as Parameters<typeof t>[0]) as string;
  // Which row's reimburse / settle is mid-flight (so only that button shows pending).
  const pendingId = (sub: typeof reSub) =>
    sub.pending ? Number((sub.input?.[0] as FormData | undefined)?.get("id")) : null;

  let formEl: HTMLFormElement | undefined;
  // On a successful save, clear the form so the manager can keep entering the day's expenses.
  createEffect(() => {
    if (submission.result?.ok) {
      formEl?.reset();
      setDate(todayLocal());
      setAmount(0);
      setCurrency("EUR");
    }
  });

  const visible = createMemo(() => {
    const f = payerFilter();
    if (f === "all") return expenses();
    if (f === "none") return expenses().filter((e) => e.payerUserId == null);
    return expenses().filter((e) => e.payerUserId === Number(f));
  });

  const unattributed = createMemo(() => {
    const rows = expenses().filter((e) => e.payerUserId == null);
    return { count: rows.length, total: rows.reduce((s, e) => s + e.amountEur, 0) };
  });

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("nav.expenses")}</h1>
        </div>
        <div class="page-head-actions">
          <A href="/suppliers">{t("suppliers.manage")}</A>
          <A href="/categories">{t("categories.manage")}</A>
          <button
            type="button"
            onClick={() => {
              submission.clear?.(); // fresh modal each open — no stale saved/error banner
              setFormOpen(true);
            }}
          >
            + {t("expenses.add")}
          </button>
        </div>
      </header>

      <Modal open={formOpen()} onClose={() => setFormOpen(false)} title={t("expenses.add")}>
        <form
          ref={formEl}
          action={addExpense}
          method="post"
          enctype="multipart/form-data"
          class="toolbar entry-form"
        >
          {/* When + how much */}
          <div class="tb-group">
            <label class="tb-field">
              <span>{t("common.date")}</span>
              <input
                type="date"
                name="date"
                required
                value={date()}
                onInput={(e) => setDate(e.currentTarget.value)}
              />
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
          </div>

          {/* Classify */}
          <div class="tb-group">
            <label class="tb-field">
              <span>{t("expenses.category")}</span>
              <select name="categoryId">
                <option value="">—</option>
                <For each={categories()}>{(c) => <option value={c.id}>{c.name}</option>}</For>
              </select>
            </label>
            <label class="tb-field">
              <span>{t("expenses.supplier")}</span>
              <select name="supplierId">
                <option value="">—</option>
                <For each={suppliers()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
              </select>
            </label>
            {/* EX-8: payer defaults to the current user (they fronted it). */}
            <label class="tb-field">
              <span>{t("expenses.payer")}</span>
              <select name="paidByUserId">
                <For each={me().users}>
                  {(u) => (
                    <option value={u.id} selected={u.id === me().meId}>
                      {u.name}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </div>

          {/* Describe + attach */}
          <div class="tb-group">
            <label class="tb-field tb-grow">
              <span>{t("expenses.detail")}</span>
              <input name="detail" />
            </label>
            <label class="tb-field">
              <span>{t("expenses.receipt")}</span>
              <input type="file" name="receipt" accept="image/*,application/pdf" />
            </label>
          </div>

          <button type="submit" disabled={submission.pending}>
            {submission.pending ? t("common.saving") : t("common.save")}
          </button>
        </form>

        <FxPreview date={date()} amount={amount()} currency={currency()} autoFetch />

        <Show when={submission.result?.ok}>
          <p class="alert alert-success" role="status">
            {t("expenses.saved")}
          </p>
        </Show>

        <Show when={submission.result?.error}>
          {(code) => (
            <p class="alert alert-error" role="alert">
              {errMsg(code())}
            </p>
          )}
        </Show>
      </Modal>

      {/* Row actions (reimburse / settle) surface their outcome here rather than failing silently. */}
      <Show when={reSub.result?.error}>
        {(code) => (
          <p class="alert alert-error" role="alert">
            {errMsg(code())}
          </p>
        )}
      </Show>
      <Show when={settleSub.result?.error}>
        {(code) => (
          <p class="alert alert-error" role="alert">
            {errMsg(code())}
          </p>
        )}
      </Show>

      <Show when={unattributed().count > 0}>
        <p class="alert alert-warn">
          {t("expenses.unattributed", {
            count: String(unattributed().count),
            total: money(unattributed().total),
          })}
        </p>
      </Show>

      {/* EX-10: discriminate the ledger by payer. */}
      <div class="toolbar filter">
        <span class="toolbar-label">{t("expenses.filterByPayer")}</span>
        <select value={payerFilter()} onChange={(e) => setPayerFilter(e.currentTarget.value)}>
          <option value="all">{t("expenses.allUsers")}</option>
          <For each={me().users}>{(u) => <option value={u.id}>{u.name}</option>}</For>
          <option value="none">{t("expenses.unassigned")}</option>
        </select>
      </div>

      <div class="panel table-scroll">
        <table class="cards">
          <thead>
            <tr>
              <th>{t("common.date")}</th>
              <th>{t("expenses.detail")}</th>
              <th>{t("expenses.payer")}</th>
              <th class="num">EUR</th>
              <th class="num">ARS</th>
              <th class="num">{t("common.rate")}</th>
              <th>{t("expenses.reimbursement")}</th>
              <th>{t("expenses.receipt")}</th>
            </tr>
          </thead>
          <tbody>
            <For
              each={visible()}
              fallback={
                <tr>
                  <td colspan="8" class="note">
                    {t("expenses.empty")}
                  </td>
                </tr>
              }
            >
              {(e) => (
                <tr>
                  <td>{e.date}</td>
                  <td data-label={t("expenses.detail")}>{e.detail}</td>
                  <td data-label={t("expenses.payer")}>
                    {e.payerName ?? t("expenses.unassigned")}
                  </td>
                  <td class="num" data-label="EUR">
                    {money(e.amountEur)}
                  </td>
                  <td class="num" data-label="ARS">
                    {money(e.amountArs)}
                  </td>
                  <td class="num" data-label={t("common.rate")}>
                    {e.fxRate}
                  </td>
                  <td data-label={t("expenses.reimbursement")}>
                    <Show when={e.reimbursement === "reimbursed"}>
                      <span class="chip chip-pos">{t("expenses.status_reimbursed")}</span>
                    </Show>
                    <Show when={e.reimbursement === "pending"}>
                      <span class="cell-actions">
                        <span class="chip chip-pending">{t("expenses.status_pending")}</span>
                        <Show when={me().canReimburse}>
                          <form action={reimburseExpense} method="post" class="inline-form">
                            <input type="hidden" name="id" value={e.id} />
                            <button
                              type="submit"
                              disabled={pendingId(reSub) === e.id}
                              onClick={(ev) => {
                                if (!confirm(t("expenses.confirmReimburse"))) ev.preventDefault();
                              }}
                            >
                              {pendingId(reSub) === e.id
                                ? t("common.saving")
                                : t("expenses.reimburse")}
                            </button>
                          </form>
                        </Show>
                      </span>
                    </Show>
                    {/* EX-12: an owner fronted this — offer to repay them from the Caja. */}
                    <Show
                      when={
                        e.reimbursement === "not_applicable" && e.payerIsOwner && me().canReimburse
                      }
                    >
                      <form action={settleExpenseAction} method="post" class="inline-form">
                        <input type="hidden" name="id" value={e.id} />
                        <button
                          type="submit"
                          disabled={pendingId(settleSub) === e.id}
                          onClick={(ev) => {
                            if (!confirm(t("expenses.confirmSettle"))) ev.preventDefault();
                          }}
                        >
                          {pendingId(settleSub) === e.id
                            ? t("common.saving")
                            : t("expenses.settle")}
                        </button>
                      </form>
                    </Show>
                  </td>
                  <td data-label={t("expenses.receipt")}>
                    <Show when={e.receiptUrl} fallback={<span class="note-faint">—</span>}>
                      <a href={`/api/receipt?id=${e.id}`} target="_blank" rel="noopener">
                        {t("expenses.receipt")}
                      </a>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      <Show when={userTotals().length > 0}>
        <section class="panel">
          <div class="panel-head">
            <h2>{t("expenses.totalsByUser")}</h2>
          </div>
          <table>
            <tbody>
              <For each={userTotals()}>
                {(u) => (
                  <tr>
                    <td>{u.name ?? t("expenses.unassigned")}</td>
                    <td class="num">{money(u.totalEur)} EUR</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>
      </Show>
    </AppShell>
  );
}
