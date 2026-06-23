import { action, createAsync, query, useSearchParams, useSubmission } from "@solidjs/router";
import { For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { Modal } from "~/components/Modal";
import { listExpenses } from "~/db/expenses";
import { db } from "~/db/index";
import { createTask, listSeasons, listTasks, setTaskStatus } from "~/db/maintenance";
import { createEntityForm } from "~/lib/createEntityForm";
import { useI18n } from "~/lib/i18n";
import { recordAudit, requireUser } from "~/lib/session";

interface Filter {
  season?: string;
  status?: "pending" | "done";
}

const tasksQuery = query(async (filter: Filter) => {
  "use server";
  await requireUser();
  return listTasks(db, filter);
}, "tasks");

const seasonsQuery = query(async () => {
  "use server";
  await requireUser();
  return listSeasons(db);
}, "seasons");

const expensesQuery = query(async () => {
  "use server";
  await requireUser();
  return listExpenses(db).map((e) => ({ id: e.id, date: e.date, detail: e.detail }));
}, "taskExpenses");

const addTask = action(async (form: FormData) => {
  "use server";
  await requireUser();
  const date = String(form.get("date") ?? "");
  const description = String(form.get("description") ?? "").trim();
  const season = String(form.get("season") ?? "").trim();
  const expenseRaw = form.get("expenseId");
  const expenseId = expenseRaw ? Number(expenseRaw) : undefined;
  if (!date || !description || !season) return { error: "invalid" };
  createTask(db, { date, description, season, expenseId });
  await recordAudit("create", "maintenanceTask");
  return { ok: true };
}, "addTask");

const toggleTask = action(async (form: FormData) => {
  "use server";
  await requireUser();
  setTaskStatus(db, Number(form.get("id")), form.get("status") === "done" ? "done" : "pending");
  await recordAudit("update", "maintenanceTask");
  return { ok: true };
}, "toggleTask");

export default function Maintenance() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const p = (k: keyof Filter) => {
    const v = params[k];
    return typeof v === "string" && v ? v : undefined;
  };
  const tasks = createAsync(
    () => tasksQuery({ season: p("season"), status: p("status") as Filter["status"] }),
    { initialValue: [] },
  );
  const seasons = createAsync(() => seasonsQuery(), { initialValue: [] });
  const expenses = createAsync(() => expensesQuery(), { initialValue: [] });
  const adding = useSubmission(addTask);
  const thisYear = String(new Date().getFullYear());
  const form = createEntityForm(adding);

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("nav.tasks")}</h1>
        </div>
        <div class="page-head-actions">
          <button type="button" onClick={form.openForm}>
            + {t("maintenance.add")}
          </button>
        </div>
      </header>

      <Modal open={form.open()} onClose={() => form.setOpen(false)} title={t("maintenance.add")}>
        <form ref={form.setRef} action={addTask} method="post" class="toolbar entry-form">
          <label class="tb-field">
            <span>{t("common.date")}</span>
            <input type="date" name="date" required />
          </label>
          <label class="tb-field tb-grow">
            <span>{t("maintenance.description")}</span>
            <input name="description" required />
          </label>
          <label class="tb-field">
            <span>{t("maintenance.season")}</span>
            <input name="season" value={thisYear} size="6" required />
          </label>
          <label class="tb-field tb-grow">
            <span>{t("maintenance.linkExpense")}</span>
            <select name="expenseId">
              <option value="">—</option>
              <For each={expenses()}>
                {(e) => (
                  <option value={e.id}>
                    #{e.id} {e.date} {e.detail ?? ""}
                  </option>
                )}
              </For>
            </select>
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
            {t("maintenance.invalid")}
          </p>
        </Show>
      </Modal>

      {/* Filters (GET, URL-driven) */}
      <form method="get" class="toolbar filter">
        <span class="toolbar-label">{t("bookings.filter")}</span>
        <select name="season">
          <option value="">{t("maintenance.season")}</option>
          <For each={seasons()}>
            {(s) => (
              <option value={s} selected={p("season") === s}>
                {s}
              </option>
            )}
          </For>
        </select>
        <select name="status">
          <option value="">—</option>
          <option value="pending" selected={p("status") === "pending"}>
            {t("maintenance.pending")}
          </option>
          <option value="done" selected={p("status") === "done"}>
            {t("maintenance.done")}
          </option>
        </select>
        <button type="submit" class="btn-ghost">
          {t("bookings.filter")}
        </button>
      </form>

      <div class="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("common.date")}</th>
              <th>{t("maintenance.season")}</th>
              <th>{t("maintenance.description")}</th>
              <th>{t("maintenance.status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For
              each={tasks()}
              fallback={
                <tr>
                  <td colspan="5" class="note">
                    {t("maintenance.empty")}
                  </td>
                </tr>
              }
            >
              {(task) => (
                <tr>
                  <td>{task.date}</td>
                  <td>{task.season}</td>
                  <td>
                    {task.description}
                    <Show when={task.expenseId}>
                      {" "}
                      · <a href="/expenses">#{task.expenseId}</a>
                    </Show>
                  </td>
                  <td>
                    <span class={task.status === "done" ? "chip chip-pos" : "chip chip-pending"}>
                      {task.status === "done" ? t("maintenance.done") : t("maintenance.pending")}
                    </span>
                  </td>
                  <td class="num">
                    <form action={toggleTask} method="post">
                      <input type="hidden" name="id" value={task.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={task.status === "done" ? "pending" : "done"}
                      />
                      <button type="submit">
                        {task.status === "done"
                          ? t("maintenance.markPending")
                          : t("maintenance.markDone")}
                      </button>
                    </form>
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
