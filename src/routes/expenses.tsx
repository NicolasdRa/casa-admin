import { A, action, createAsync, query, useSubmission } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import { FxPreview } from "~/components/FxPreview";
import { createExpense, expenseTotalsByPartner, listCategories, listExpenses } from "~/db/expenses";
import { db } from "~/db/index";
import { listSuppliers } from "~/db/suppliers";
import { useI18n } from "~/lib/i18n";
import { fromCents, toCents } from "~/lib/money";

const listExpensesQuery = query(async () => {
  "use server";
  return listExpenses(db);
}, "expenses");

const listCategoriesQuery = query(async () => {
  "use server";
  return listCategories(db);
}, "categories");

const listSuppliersQuery = query(async () => {
  "use server";
  return listSuppliers(db);
}, "suppliers");

const partnerTotalsQuery = query(async () => {
  "use server";
  return expenseTotalsByPartner(db);
}, "expensePartnerTotals");

const addExpense = action(async (form: FormData) => {
  "use server";
  const date = String(form.get("date") ?? "");
  const currency = form.get("currency") === "ARS" ? "ARS" : "EUR";
  const amount = Number(form.get("amount"));
  const detail = String(form.get("detail") ?? "").trim() || undefined;
  const categoryRaw = form.get("categoryId");
  const categoryId = categoryRaw ? Number(categoryRaw) : undefined;
  const supplierRaw = form.get("supplierId");
  const supplierId = supplierRaw ? Number(supplierRaw) : undefined;
  if (!date) return { error: "date_required" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "amount_invalid" };
  try {
    createExpense(db, { date, currency, amount: toCents(amount), detail, categoryId, supplierId });
  } catch (e) {
    return { error: (e as Error).message };
  }
  return { ok: true };
}, "addExpense");

export const route = {
  preload: () => {
    listExpensesQuery();
    listCategoriesQuery();
    listSuppliersQuery();
    partnerTotalsQuery();
  },
};

export default function Expenses() {
  const { t } = useI18n();
  const expenses = createAsync(() => listExpensesQuery(), { initialValue: [] });
  const categories = createAsync(() => listCategoriesQuery(), { initialValue: [] });
  const suppliers = createAsync(() => listSuppliersQuery(), { initialValue: [] });
  const partnerTotals = createAsync(() => partnerTotalsQuery(), { initialValue: [] });
  const [date, setDate] = createSignal("");
  const [amount, setAmount] = createSignal(0);
  const [currency, setCurrency] = createSignal<"ARS" | "EUR">("EUR");
  const submission = useSubmission(addExpense);
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
      <h1>{t("nav.expenses")}</h1>

      <form
        action={addExpense}
        method="post"
        style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap", margin: "1rem 0" }}
      >
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
        <input name="detail" placeholder={t("expenses.detail")} />
        <button type="submit">{t("common.save")}</button>
      </form>

      <FxPreview date={date()} amount={amount()} currency={currency()} />

      <p>
        <A href="/suppliers">{t("suppliers.manage")}</A>
      </p>

      <Show when={submission.result?.error}>
        {(err) => <p style={{ color: "crimson" }}>{err()}</p>}
      </Show>

      <table style={{ "border-collapse": "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{t("common.date")}</th>
            <th style={cell}>{t("expenses.detail")}</th>
            <th style={cell}>EUR</th>
            <th style={cell}>ARS</th>
            <th style={cell}>{t("common.rate")}</th>
            <th style={cell}>{t("common.rateDate")}</th>
          </tr>
        </thead>
        <tbody>
          <For
            each={expenses()}
            fallback={
              <tr>
                <td colspan="6" style={cell}>
                  {t("expenses.empty")}
                </td>
              </tr>
            }
          >
            {(e) => (
              <tr>
                <td style={cell}>{e.date}</td>
                <td style={cell}>{e.detail}</td>
                <td style={cell}>{money(e.amountEur)}</td>
                <td style={cell}>{money(e.amountArs)}</td>
                <td style={cell}>{e.fxRate}</td>
                <td style={cell}>{e.fxRateDate}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>

      <Show when={partnerTotals().length > 0}>
        <h2 style={{ "margin-top": "2rem", "font-size": "1.1rem" }}>{t("expenses.byPartner")}</h2>
        <table style={{ "border-collapse": "collapse", width: "100%" }}>
          <tbody>
            <For each={partnerTotals()}>
              {(p) => (
                <tr>
                  <td style={cell}>{p.name}</td>
                  <td style={cell}>{money(p.totalEur)} EUR</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </main>
  );
}
