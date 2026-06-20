import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { createMemo, For, Show } from "solid-js";
import { createCashEntry, listCashLedger } from "~/db/cash";
import { db } from "~/db/index";
import { listPartners } from "~/db/partners";
import { partnerStatements } from "~/db/statements";
import { useI18n } from "~/lib/i18n";
import { fromCents, toCents } from "~/lib/money";
import { can } from "~/lib/permissions";
import { currentUser, recordAudit } from "~/lib/session";

async function requireCash() {
  const me = await currentUser();
  if (!me || !can(me.role, "managePartnersCash")) throw redirect("/");
  return me;
}

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

export default function Caja() {
  const { t } = useI18n();
  const ledger = createAsync(() => ledgerQuery(), { initialValue: [] });
  const partners = createAsync(() => partnersQuery(), { initialValue: [] });
  const statements = createAsync(() => statementsQuery(), { initialValue: [] });
  const adding = useSubmission(addCashEntry);
  const money = (c: number) => fromCents(c).toFixed(2);
  const cell = { padding: "0.4rem 0.6rem", "border-bottom": "1px solid #eee" } as const;
  const partnerName = createMemo(() => new Map(partners().map((p) => [p.id, p.name])));

  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "62rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>{t("caja.title")}</h1>

      <form
        action={addCashEntry}
        method="post"
        style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap", margin: "1rem 0" }}
      >
        <input type="date" name="date" required />
        <select name="partnerId" required>
          <For each={partners()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </select>
        <select name="type">
          <option value="contribution">{t("caja.contribution")}</option>
          <option value="withdrawal">{t("caja.withdrawal")}</option>
          <option value="allocation">{t("caja.allocation")}</option>
        </select>
        <input name="concept" placeholder={t("caja.concept")} required />
        <input
          type="number"
          name="amount"
          step="0.01"
          min="0"
          placeholder={t("common.amount")}
          required
        />
        <button type="submit">{t("common.save")}</button>
      </form>
      <Show when={adding.result?.error}>
        <p style={{ color: "crimson" }}>{t("maintenance.invalid")}</p>
      </Show>

      <h2 style={{ "font-size": "1.1rem", "margin-top": "1.5rem" }}>{t("caja.ledger")}</h2>
      <table style={{ "border-collapse": "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{t("common.date")}</th>
            <th style={cell}>{t("caja.partner")}</th>
            <th style={cell}>{t("caja.concept")}</th>
            <th style={cell}>EUR</th>
            <th style={cell}>{t("caja.balance")}</th>
          </tr>
        </thead>
        <tbody>
          <For
            each={ledger()}
            fallback={
              <tr>
                <td colspan="5" style={cell}>
                  {t("caja.empty")}
                </td>
              </tr>
            }
          >
            {(e) => (
              <tr>
                <td style={cell}>{e.date}</td>
                <td style={cell}>{partnerName().get(e.partnerId) ?? e.partnerId}</td>
                <td style={cell}>{e.concept}</td>
                <td style={cell}>{money(e.amountEur)}</td>
                <td style={cell}>{money(e.runningBalance)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>

      <h2 style={{ "font-size": "1.1rem", "margin-top": "1.5rem" }}>{t("caja.statements")}</h2>
      <table style={{ "border-collapse": "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{t("caja.partner")}</th>
            <th style={cell}>{t("caja.income")}</th>
            <th style={cell}>{t("caja.commission")}</th>
            <th style={cell}>{t("caja.expenseShare")}</th>
            <th style={cell}>{t("caja.result")}</th>
            <th style={cell}>{t("caja.expenseNet")}</th>
            <th style={cell}>{t("caja.cashAccount")}</th>
          </tr>
        </thead>
        <tbody>
          <For each={statements()}>
            {(s) => (
              <tr>
                <td style={cell}>{s.name}</td>
                <td style={cell}>{money(s.incomeShare)}</td>
                <td style={cell}>{money(s.commissionShare)}</td>
                <td style={cell}>{money(s.expenseShare)}</td>
                <td style={cell}>{money(s.result)}</td>
                <td style={cell}>{money(s.expenseNet)}</td>
                <td style={cell}>{money(s.cashAccount)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </main>
  );
}
