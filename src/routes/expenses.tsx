import { A, action, createAsync, query, useSubmission } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import { FxPreview } from "~/components/FxPreview";
import {
  createExpense,
  expenseTotalsByPartner,
  listCategories,
  listExpenses,
  receiptPlan,
  safeExt,
  setExpenseReceipt,
} from "~/db/expenses";
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
  const manualRaw = Number(form.get("manualRate"));
  const manualRate = Number.isFinite(manualRaw) && manualRaw > 0 ? manualRaw : undefined;
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
      manualRate,
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
        enctype="multipart/form-data"
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
        <input
          type="number"
          name="manualRate"
          step="0.01"
          min="0"
          placeholder={t("common.manualRate")}
          title={t("common.manualRate")}
          size="8"
        />
        <input
          type="file"
          name="receipt"
          accept="image/*,application/pdf"
          title={t("expenses.receipt")}
        />
        <button type="submit">{t("common.save")}</button>
      </form>

      <FxPreview date={date()} amount={amount()} currency={currency()} />

      <p style={{ display: "flex", gap: "1rem" }}>
        <A href="/suppliers">{t("suppliers.manage")}</A>
        <A href="/categories">{t("categories.manage")}</A>
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
            <th style={cell}>{t("expenses.receipt")}</th>
          </tr>
        </thead>
        <tbody>
          <For
            each={expenses()}
            fallback={
              <tr>
                <td colspan="7" style={cell}>
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
                <td style={cell}>
                  <Show when={e.receiptUrl}>
                    <a href={`/api/receipt?id=${e.id}`} target="_blank" rel="noopener">
                      📎
                    </a>
                  </Show>
                </td>
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
