import { A, action, createAsync, query, useSubmission } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { FxPreview } from "~/components/FxPreview";
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
import { listSuppliers } from "~/db/suppliers";
import { listUsers } from "~/db/users";
import { useI18n } from "~/lib/i18n";
import { fromCents, toCents } from "~/lib/money";
import { can } from "~/lib/permissions";
import { recordAudit, requireUser } from "~/lib/session";

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
  if (!date) return { error: "date_required" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amount_invalid" };
  try {
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
      let data = Buffer.from(await receipt.arrayBuffer());
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
    return { error: (e as Error).message };
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
    return { error: (e as Error).message };
  }
  return { ok: true };
}, "reimburseExpense");

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
  const [date, setDate] = createSignal("");
  const [amount, setAmount] = createSignal(0);
  const [currency, setCurrency] = createSignal<"ARS" | "EUR">("EUR");
  // EX-10: filter the ledger by payer. "all" | "none" (unassigned) | user id.
  const [payerFilter, setPayerFilter] = createSignal<string>("all");
  const submission = useSubmission(addExpense);
  const money = (cents: number) => fromCents(cents).toFixed(2);

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
        </div>
      </header>

      <form action={addExpense} method="post" enctype="multipart/form-data" class="toolbar">
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
        <select name="categoryId">
          <option value="">{t("expenses.category")}</option>
          <For each={categories()}>{(c) => <option value={c.id}>{c.name}</option>}</For>
        </select>
        <select name="supplierId">
          <option value="">{t("expenses.supplier")}</option>
          <For each={suppliers()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
        </select>
        {/* EX-8: payer defaults to the current user (they fronted it). */}
        <select name="paidByUserId" title={t("expenses.payer")}>
          <For each={me().users}>
            {(u) => (
              <option value={u.id} selected={u.id === me().meId}>
                {u.name}
              </option>
            )}
          </For>
        </select>
        <input name="detail" placeholder={t("expenses.detail")} />
        <input
          type="file"
          name="receipt"
          accept="image/*,application/pdf"
          title={t("expenses.receipt")}
        />
        <button type="submit">{t("common.save")}</button>
      </form>

      <FxPreview date={date()} amount={amount()} currency={currency()} />

      <Show when={submission.result?.error}>
        {(err) => <p class="alert alert-error">{err()}</p>}
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
        <span class="toolbar-label">{t("expenses.byUser")}</span>
        <select value={payerFilter()} onChange={(e) => setPayerFilter(e.currentTarget.value)}>
          <option value="all">{t("expenses.allUsers")}</option>
          <For each={me().users}>{(u) => <option value={u.id}>{u.name}</option>}</For>
          <option value="none">{t("expenses.unassigned")}</option>
        </select>
      </div>

      <div class="panel table-scroll">
        <table>
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
                  <td>{e.detail}</td>
                  <td>{e.payerName ?? t("expenses.unassigned")}</td>
                  <td class="num">{money(e.amountEur)}</td>
                  <td class="num">{money(e.amountArs)}</td>
                  <td class="num">{e.fxRate}</td>
                  <td>
                    <Show when={e.reimbursement === "reimbursed"}>
                      <span class="chip chip-pos">{t("expenses.status_reimbursed")}</span>
                    </Show>
                    <Show when={e.reimbursement === "pending"}>
                      <span style={{ display: "inline-flex", gap: "8px", "align-items": "center" }}>
                        <span class="chip chip-pending">{t("expenses.status_pending")}</span>
                        <Show when={me().canReimburse}>
                          <form
                            action={reimburseExpense}
                            method="post"
                            style={{ display: "inline" }}
                          >
                            <input type="hidden" name="id" value={e.id} />
                            <button type="submit">{t("expenses.reimburse")}</button>
                          </form>
                        </Show>
                      </span>
                    </Show>
                  </td>
                  <td>
                    <Show when={e.receiptUrl}>
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
            <h2>{t("expenses.byUser")}</h2>
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
