import { A, action, createAsync, query, useSubmission } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { useConfirm } from "~/components/ConfirmProvider";
import {
  type ExpenseRow,
  ExpensesSummary,
  listCategoriesQuery,
  listExpensesQuery,
  listSuppliersQuery,
} from "~/components/ExpensesSummary";
import { FxPreview } from "~/components/FxPreview";
import { Modal } from "~/components/Modal";
import { ensureFxRate } from "~/db/bna";
import {
  createExpense,
  deleteExpense,
  markExpenseReimbursed,
  receiptPlan,
  reimburseExpenses,
  safeExt,
  setExpenseReceipt,
  updateExpenseMeta,
} from "~/db/expenses";
import { db } from "~/db/index";
import { settleExpense } from "~/db/settlement";
import { listUsers } from "~/db/users";
import { createEntityForm } from "~/lib/createEntityForm";
import { inDateRange } from "~/lib/dateRange";
import { useI18n } from "~/lib/i18n";
import { formatMoney, toCents } from "~/lib/money";
import { runMutation } from "~/lib/mutation";
import { can, defaultEntryCurrency, mayReimburse } from "~/lib/permissions";
import { recordAudit, requireUser } from "~/lib/session";

// Dismiss the native popover a menu button lives in — top-layer menus don't close on inner clicks.
function closePopover(el: HTMLElement) {
  el.closest<HTMLElement>("[popover]")?.hidePopover();
}

// Today in the *local* calendar (not UTC) — the manager enters expenses for the day they're living.
const todayLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Payer options + who I am (for the form default and to gate the reimburse action in the UI).
const meAndUsersQuery = query(async () => {
  "use server";
  const me = await requireUser();
  const users = listUsers(db).map((u) => ({ id: u.id, name: u.name }));
  return {
    meId: me.id,
    canReimburse: mayReimburse(me),
    // CA-117: bulk reimburse is one tier stricter than the per-row action.
    canBulkReimburse: me.role === "superadmin" && mayReimburse(me),
    // CA-110: admin+ may delete an expense (the db guard still blocks a settled one).
    canDelete: can(me.role, "deleteExpenses"),
    defaultCurrency: defaultEntryCurrency(me.role),
    users,
  };
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
  return runMutation({ audit: ["create", "expense"] }, async () => {
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
  });
}, "addExpense");

// EX-9: admin reimburses a co-host's pending expense; permission enforced server-side.
const reimburseExpense = action(async (form: FormData) => {
  "use server";
  const me = await requireUser();
  if (!mayReimburse(me)) return { error: "forbidden" };
  const id = Number(form.get("id"));
  const today = new Date().toISOString().slice(0, 10);
  return runMutation({ audit: ["update", `expense:${id}`] }, () => {
    markExpenseReimbursed(db, id, me.id, today);
  });
}, "reimburseExpense");

// CA-117: bulk-reimburse the selected pending co-host expenses. Superadmin-only — a step above the
// per-row reimburse (admin+), since it fires across many rows at once. The owner-mapping + pending
// guards still hold per row in reimburseExpenses; the batch is all-or-nothing.
const bulkReimburseExpenses = action(async (form: FormData) => {
  "use server";
  const me = await requireUser();
  if (me.role !== "superadmin" || !mayReimburse(me)) return { error: "forbidden" };
  const ids = form.getAll("id").map(Number);
  const today = new Date().toISOString().slice(0, 10);
  return runMutation({ audit: ["update", "expense"] }, () => {
    reimburseExpenses(db, ids, me.id, today);
  });
}, "bulkReimburseExpenses");

// EX-12: repay an owner for an expense they fronted. Records the Caja withdrawal (dated today, when
// the cash leaves the box) and marks the expense reimbursed. Same permission gate as reimburse.
const settleExpenseAction = action(async (form: FormData) => {
  "use server";
  const me = await requireUser();
  if (!mayReimburse(me)) return { error: "forbidden" };
  const id = Number(form.get("id"));
  const today = new Date().toISOString().slice(0, 10);
  const res = settleExpense(db, id, today);
  if (!res) return { error: "notSettleable" };
  await recordAudit("update", `expense:${id}`);
  return { ok: true };
}, "settleExpense");

// CA-110: admin deletes an expense. Permission is gated here; the db guard still refuses a
// reimbursed/settled one (it's already reflected in the Caja) by throwing CodedError("settled").
const deleteExpenseAction = action(async (form: FormData) => {
  "use server";
  const me = await requireUser();
  if (!can(me.role, "deleteExpenses")) return { error: "forbidden" };
  const id = Number(form.get("id"));
  return runMutation({ audit: ["delete", `expense:${id}`] }, () => {
    deleteExpense(db, id);
  });
}, "deleteExpense");

// Edit an expense's classification (detail/category/supplier) from the row action menu. Money,
// currency, date and the FX snapshot are entered once and never editable here.
const editExpense = action(async (form: FormData) => {
  "use server";
  await requireUser();
  const id = Number(form.get("id"));
  const detail = String(form.get("detail") ?? "").trim() || null;
  const categoryRaw = form.get("categoryId");
  const categoryId = categoryRaw ? Number(categoryRaw) : null;
  const supplierRaw = form.get("supplierId");
  const supplierId = supplierRaw ? Number(supplierRaw) : null;
  // EX-8: payer is editable here so imported/unattributed rows can be attributed; "" clears it.
  const payerRaw = form.get("paidByUserId");
  const paidByUserId = payerRaw ? Number(payerRaw) : null;
  return runMutation({ audit: ["update", `expense:${id}`] }, () => {
    updateExpenseMeta(db, id, { detail, categoryId, supplierId, paidByUserId });
  });
}, "editExpense");

export const route = {
  preload: () => {
    listExpensesQuery();
    listCategoriesQuery();
    listSuppliersQuery();
    meAndUsersQuery();
  },
};

export default function Expenses() {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const expenses = createAsync(() => listExpensesQuery(), { initialValue: [] });
  const categories = createAsync(() => listCategoriesQuery(), { initialValue: [] });
  const suppliers = createAsync(() => listSuppliersQuery(), { initialValue: [] });
  const me = createAsync(() => meAndUsersQuery(), {
    initialValue: {
      meId: 0,
      canReimburse: false,
      canBulkReimburse: false,
      canDelete: false,
      defaultCurrency: "EUR" as const,
      users: [],
    },
  });
  // Default the date to today — the heaviest path is entering today's spend; still freely editable.
  const [date, setDate] = createSignal(todayLocal());
  const [amount, setAmount] = createSignal(0);
  const [currency, setCurrency] = createSignal<"ARS" | "EUR">("EUR");
  // EX-10: filter the ledger by payer. "all" | "none" (unassigned) | user id.
  const [payerFilter, setPayerFilter] = createSignal<string>("all");
  // CA-115: filter by supplier. "all" | "none" (no supplier) | supplier id.
  const [supplierFilter, setSupplierFilter] = createSignal<string>("all");
  // CA-116: optional sort by supplier name. null = keep the default date-desc order from the query.
  const [supplierSort, setSupplierSort] = createSignal<"asc" | "desc" | null>(null);
  // CA-99: inclusive date-range filter on the ledger. "" on either side = open on that side.
  const [dateFrom, setDateFrom] = createSignal("");
  const [dateTo, setDateTo] = createSignal("");
  // CA-117: bulk-reimburse selection, a Set of expense ids.
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  // Add-expense lives in a modal so the ledger keeps the page; opened from the primary action.
  const submission = useSubmission(addExpense);
  const reSub = useSubmission(reimburseExpense);
  const settleSub = useSubmission(settleExpenseAction);
  const editSub = useSubmission(editExpense);
  const bulkReSub = useSubmission(bulkReimburseExpenses);
  const delSub = useSubmission(deleteExpenseAction);
  // The expense whose edit modal is open (null = closed). Holds the row so the form pre-fills.
  const [editing, setEditing] = createSignal<ExpenseRow | null>(null);
  const supplierNameById = createMemo(() => new Map(suppliers().map((s) => [s.id, s.name])));
  const supplierName = (id: number | null) =>
    id != null ? (supplierNameById().get(id) ?? null) : null;
  const money = (cents: number) => formatMoney(cents, locale());
  // Translate a returned error code to a human, localized message; raw codes never render.
  const errMsg = (code: string) => t(`expenses.err_${code}` as Parameters<typeof t>[0]) as string;
  // Which row's reimburse / settle is mid-flight (so only that button shows pending).
  const pendingId = (sub: typeof reSub | typeof settleSub | typeof delSub) =>
    sub.pending ? Number((sub.input?.[0] as FormData | undefined)?.get("id")) : null;

  let amountEl: HTMLInputElement | undefined;
  // On a successful save the primitive resets the <form>; we also reset the controlled fields so the
  // manager can keep entering the day's expenses, cursor jumping straight back to amount.
  const form = createEntityForm(submission, () => {
    setDate(todayLocal());
    setAmount(0);
    setCurrency(me().defaultCurrency); // back to the entrant's working currency, not hardcoded EUR
    amountEl?.focus(); // save-and-add-next: cursor straight back to amount for the next row
  });

  // Close the edit modal once its save lands.
  createEffect(() => {
    if (editSub.result?.ok) setEditing(null);
  });

  // Filter + sort are client-side: the ledger is already loaded and small, so a round-trip would
  // only add latency. Payer (EX-10) and supplier (CA-115) filters compose; supplier sort (CA-116)
  // is applied last, falling back to the query's date-desc order when off.
  const visible = createMemo(() => {
    const p = payerFilter();
    const s = supplierFilter();
    const from = dateFrom();
    const to = dateTo();
    let rows = expenses();
    if (p === "none") rows = rows.filter((e) => e.payerUserId == null);
    else if (p !== "all") rows = rows.filter((e) => e.payerUserId === Number(p));
    if (s === "none") rows = rows.filter((e) => e.supplierId == null);
    else if (s !== "all") rows = rows.filter((e) => e.supplierId === Number(s));
    if (from || to) rows = rows.filter((e) => inDateRange(e.date, from, to));
    const dir = supplierSort();
    if (dir) {
      const sign = dir === "asc" ? 1 : -1;
      rows = [...rows].sort(
        (a, b) =>
          sign * (supplierName(a.supplierId) ?? "").localeCompare(supplierName(b.supplierId) ?? ""),
      );
    }
    return rows;
  });

  // CA-117: only pending co-host rows are reimbursable, so the bulk machinery operates on those —
  // non-pending rows get no checkbox, keeping the selection always valid for the action.
  const selectable = createMemo(() => visible().filter((e) => e.reimbursement === "pending"));
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allSelected = () =>
    selectable().length > 0 && selectable().every((e) => selected().has(e.id));
  const toggleAll = () =>
    setSelected(allSelected() ? new Set<number>() : new Set(selectable().map((e) => e.id)));
  // Drop the selection once a bulk reimburse lands so the (now non-pending) ids don't linger.
  createEffect(() => {
    if (bulkReSub.result?.ok) setSelected(new Set<number>());
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
              form.openForm(); // fresh modal each open — no stale saved/error banner
              setCurrency(me().defaultCurrency); // manager opens straight into ARS; autofocus lands on amount
            }}
          >
            + {t("expenses.add")}
          </button>
        </div>
      </header>

      <Modal open={form.open()} onClose={() => form.setOpen(false)} title={t("expenses.add")}>
        <form
          ref={form.setRef}
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
                ref={amountEl}
                type="number"
                name="amount"
                step="0.01"
                min="0"
                required
                autofocus
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

      {/* Edit modal: only the classification (detail/category/supplier) is mutable — money, currency,
          date and the FX snapshot are entered once and shown read-only. */}
      <Modal
        open={editing() != null}
        onClose={() => setEditing(null)}
        title={t("expenses.editTitle")}
      >
        <Show when={editing()}>
          {(e) => (
            <form action={editExpense} method="post" class="toolbar entry-form">
              <input type="hidden" name="id" value={e().id} />
              <p class="note-faint">
                {e().date} · {money(e().amountEur)} EUR · {money(e().amountArs)} ARS
              </p>
              <div class="tb-group">
                <label class="tb-field">
                  <span>{t("expenses.category")}</span>
                  <select name="categoryId">
                    <option value="">—</option>
                    <For each={categories()}>
                      {(c) => (
                        <option value={c.id} selected={c.id === e().categoryId}>
                          {c.name}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
                <label class="tb-field">
                  <span>{t("expenses.supplier")}</span>
                  <select name="supplierId">
                    <option value="">—</option>
                    <For each={suppliers()}>
                      {(s) => (
                        <option value={s.id} selected={s.id === e().supplierId}>
                          {s.name}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
                {/* EX-8: attribute (or re-attribute) the payer — the fix path for the
                    "unattributed" warning. Blank = leave unassigned. */}
                <label class="tb-field">
                  <span>{t("expenses.payer")}</span>
                  <select name="paidByUserId">
                    <option value="">{t("expenses.unassigned")}</option>
                    <For each={me().users}>
                      {(u) => (
                        <option value={u.id} selected={u.id === e().payerUserId}>
                          {u.name}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </div>
              <div class="tb-group">
                <label class="tb-field tb-grow">
                  <span>{t("expenses.detail")}</span>
                  <input name="detail" value={e().detail ?? ""} />
                </label>
              </div>
              <button type="submit" disabled={editSub.pending}>
                {editSub.pending ? t("common.saving") : t("common.save")}
              </button>
            </form>
          )}
        </Show>
      </Modal>

      {/* CA-119: gross EUR summary at the top; charts track the page's filtered set. */}
      <ExpensesSummary filtered={visible()} />

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
      <Show when={delSub.result?.error}>
        {(code) => (
          <p class="alert alert-error" role="alert">
            {errMsg(code())}
          </p>
        )}
      </Show>
      <Show when={bulkReSub.result?.error}>
        {(code) => (
          <p class="alert alert-error" role="alert">
            {errMsg(code())}
          </p>
        )}
      </Show>
      <Show when={bulkReSub.result?.ok}>
        <p class="alert alert-success" role="status">
          {t("expenses.saved")}
        </p>
      </Show>

      <Show when={unattributed().count > 0}>
        <p class="alert alert-warn">
          {t("expenses.unattributed", {
            count: String(unattributed().count),
            total: money(unattributed().total),
          })}
        </p>
      </Show>

      {/* EX-10 + CA-115: discriminate the ledger by payer and/or supplier. */}
      <div class="toolbar filter">
        <span class="toolbar-label">{t("expenses.filterByDate")}</span>
        <input
          type="date"
          aria-label={t("expenses.dateFrom")}
          value={dateFrom()}
          max={dateTo() || undefined}
          onInput={(e) => setDateFrom(e.currentTarget.value)}
        />
        <input
          type="date"
          aria-label={t("expenses.dateTo")}
          value={dateTo()}
          min={dateFrom() || undefined}
          onInput={(e) => setDateTo(e.currentTarget.value)}
        />
        <span class="toolbar-label">{t("expenses.filterByPayer")}</span>
        <select value={payerFilter()} onChange={(e) => setPayerFilter(e.currentTarget.value)}>
          <option value="all">{t("expenses.allUsers")}</option>
          <For each={me().users}>{(u) => <option value={u.id}>{u.name}</option>}</For>
          <option value="none">{t("expenses.unassigned")}</option>
        </select>
        <span class="toolbar-label">{t("expenses.filterBySupplier")}</span>
        <select
          value={supplierFilter()}
          onChange={(e) => setSupplierFilter(e.currentTarget.value)}
          aria-label={t("expenses.filterBySupplier")}
        >
          <option value="all">{t("expenses.allSuppliers")}</option>
          <For each={suppliers()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
          <option value="none">{t("expenses.unassigned")}</option>
        </select>
        {/* CA-117: bulk reimburse bar — superadmin-only, appears only with a live selection. */}
        <Show when={me().canBulkReimburse && selected().size > 0}>
          <span class="toolbar-label">
            {selected().size} {t("expenses.selected")}
          </span>
          <form action={bulkReimburseExpenses} method="post">
            <For each={[...selected()]}>{(id) => <input type="hidden" name="id" value={id} />}</For>
            <button
              type="submit"
              class="btn-ghost"
              disabled={bulkReSub.pending}
              onClick={async (ev) => {
                ev.preventDefault();
                const f = ev.currentTarget.form;
                if (
                  await confirm({ message: t("expenses.confirmReimburseSelected"), danger: true })
                ) {
                  f?.requestSubmit();
                }
              }}
            >
              {bulkReSub.pending ? t("common.saving") : t("expenses.reimburseSelected")}
            </button>
          </form>
        </Show>
      </div>

      <div class="panel table-scroll">
        <table class="cards">
          <thead>
            <tr>
              <Show when={me().canBulkReimburse}>
                <th class="col-check">
                  <input
                    type="checkbox"
                    checked={allSelected()}
                    onChange={toggleAll}
                    disabled={selectable().length === 0}
                    aria-label={t("common.actions")}
                  />
                </th>
              </Show>
              <th title={t("common.date")}>{t("common.date")}</th>
              <th title={t("expenses.detail")}>{t("expenses.detail")}</th>
              <th title={t("expenses.supplier")}>
                <button
                  type="button"
                  class="th-sort"
                  onClick={() =>
                    setSupplierSort((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"))
                  }
                  aria-label={t("expenses.sortBySupplier")}
                >
                  {t("expenses.supplier")}{" "}
                  <span aria-hidden="true">
                    {supplierSort() === "asc" ? "▲" : supplierSort() === "desc" ? "▼" : "↕"}
                  </span>
                </button>
              </th>
              <th title={t("expenses.payer")}>{t("expenses.payer")}</th>
              <th class="num">EUR</th>
              <th class="num">ARS</th>
              <th class="num" title={t("expenses.rateHint")}>
                {t("common.rate")}
              </th>
              <th title={t("expenses.reimbursement")}>{t("expenses.reimbursement")}</th>
              <th title={t("expenses.receipt")}>{t("expenses.receipt")}</th>
              <th class="col-actions">
                <span class="sr-only">{t("common.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <For
              each={visible()}
              fallback={
                <tr>
                  <td colspan={me().canBulkReimburse ? 11 : 10} class="note">
                    {t("expenses.empty")}
                  </td>
                </tr>
              }
            >
              {(e) => (
                <tr>
                  <Show when={me().canBulkReimburse}>
                    {/* Only pending co-host rows are selectable; others keep an empty cell so the
                        column stays aligned. */}
                    <td class="col-check">
                      <Show when={e.reimbursement === "pending"}>
                        <input
                          type="checkbox"
                          checked={selected().has(e.id)}
                          onChange={() => toggle(e.id)}
                          aria-label={e.detail ?? e.date}
                        />
                      </Show>
                    </td>
                  </Show>
                  <td>{e.date}</td>
                  <td data-label={t("expenses.detail")}>{e.detail}</td>
                  <td data-label={t("expenses.supplier")}>{supplierName(e.supplierId) ?? "—"}</td>
                  <td data-label={t("expenses.payer")}>
                    {e.payerName ?? t("expenses.unassigned")}
                  </td>
                  <td class="num" data-label="EUR">
                    {money(e.amountEur)}
                  </td>
                  <td class="num" data-label="ARS">
                    {money(e.amountArs)}
                  </td>
                  {/* Rate is ARS per €1 (see header hint); its date makes the row's conversion
                      auditable, matching FxPreview's "rate (date)" format. */}
                  <td class="num" data-label={t("common.rate")}>
                    {e.fxRate}
                    <Show when={e.fxRateDate}>
                      <span class="note-faint"> · {e.fxRateDate}</span>
                    </Show>
                  </td>
                  <td data-label={t("expenses.reimbursement")}>
                    <Show when={e.reimbursement === "reimbursed"}>
                      <span class="chip chip-pos">{t("expenses.status_reimbursed")}</span>
                    </Show>
                    <Show when={e.reimbursement === "pending"}>
                      <span class="chip chip-pending">{t("expenses.status_pending")}</span>
                    </Show>
                  </td>
                  <td data-label={t("expenses.receipt")}>
                    <Show when={e.receiptUrl} fallback={<span class="note-faint">—</span>}>
                      <a href={`/api/receipt?id=${e.id}`} target="_blank" rel="noopener">
                        {t("expenses.receipt")}
                      </a>
                    </Show>
                  </td>
                  {/* Per-row action menu: edit + the contextual reimburse/settle actions.
                      Native Popover API → top layer, so the dropdown is never clipped by the
                      table's overflow; anchor positioning ties it to this row's ⋯ trigger. */}
                  <td class="col-actions" data-label={t("common.actions")}>
                    <button
                      type="button"
                      class="row-menu-trigger"
                      aria-label={t("common.actions")}
                      popovertarget={`exp-menu-${e.id}`}
                      style={{ "anchor-name": `--exp-menu-${e.id}` }}
                    >
                      ⋯
                    </button>
                    <div
                      id={`exp-menu-${e.id}`}
                      popover="auto"
                      class="menu-pop"
                      style={{ "position-anchor": `--exp-menu-${e.id}` }}
                    >
                      <button
                        type="button"
                        class="menu-item"
                        onClick={(ev) => {
                          editSub.clear?.(); // fresh modal — no stale error banner
                          setEditing(e);
                          closePopover(ev.currentTarget);
                        }}
                      >
                        {t("common.edit")}
                      </button>
                      <Show when={e.reimbursement === "pending" && me().canReimburse}>
                        <form action={reimburseExpense} method="post">
                          <input type="hidden" name="id" value={e.id} />
                          <button
                            type="submit"
                            class="menu-item"
                            disabled={pendingId(reSub) === e.id}
                            onClick={async (ev) => {
                              ev.preventDefault();
                              const button = ev.currentTarget;
                              const form = button.form;
                              if (
                                await confirm({
                                  message: t("expenses.confirmReimburse"),
                                  danger: true,
                                })
                              ) {
                                closePopover(button);
                                form?.requestSubmit();
                              }
                            }}
                          >
                            {pendingId(reSub) === e.id
                              ? t("common.saving")
                              : t("expenses.reimburse")}
                          </button>
                        </form>
                      </Show>
                      {/* EX-12: an owner fronted this — offer to repay them from the Caja. */}
                      <Show
                        when={
                          e.reimbursement === "not_applicable" &&
                          e.payerIsOwner &&
                          me().canReimburse
                        }
                      >
                        <form action={settleExpenseAction} method="post">
                          <input type="hidden" name="id" value={e.id} />
                          <button
                            type="submit"
                            class="menu-item"
                            disabled={pendingId(settleSub) === e.id}
                            onClick={async (ev) => {
                              ev.preventDefault();
                              const button = ev.currentTarget;
                              const form = button.form;
                              if (
                                await confirm({
                                  message: t("expenses.confirmSettle"),
                                  danger: true,
                                })
                              ) {
                                closePopover(button);
                                form?.requestSubmit();
                              }
                            }}
                          >
                            {pendingId(settleSub) === e.id
                              ? t("common.saving")
                              : t("expenses.settle")}
                          </button>
                        </form>
                      </Show>
                      {/* CA-110: admin-only delete; db guard still refuses a reimbursed expense. */}
                      <Show when={me().canDelete}>
                        <form action={deleteExpenseAction} method="post">
                          <input type="hidden" name="id" value={e.id} />
                          <button
                            type="submit"
                            class="menu-item menu-item-danger"
                            disabled={pendingId(delSub) === e.id}
                            onClick={async (ev) => {
                              ev.preventDefault();
                              const button = ev.currentTarget;
                              const form = button.form;
                              if (
                                await confirm({
                                  message: t("expenses.confirmDelete"),
                                  danger: true,
                                })
                              ) {
                                closePopover(button);
                                form?.requestSubmit();
                              }
                            }}
                          >
                            {pendingId(delSub) === e.id ? t("common.saving") : t("expenses.delete")}
                          </button>
                        </form>
                      </Show>
                    </div>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
