import { action, createAsync, query, useSearchParams, useSubmission } from "@solidjs/router";
import { For, Show } from "solid-js";
import { listExpenses } from "~/db/expenses";
import { db } from "~/db/index";
import { createTask, listSeasons, listTasks, setTaskStatus } from "~/db/maintenance";
import { useI18n } from "~/lib/i18n";

interface Filter {
  season?: string;
  status?: "pending" | "done";
}

const tasksQuery = query(async (filter: Filter) => {
  "use server";
  return listTasks(db, filter);
}, "tasks");

const seasonsQuery = query(async () => {
  "use server";
  return listSeasons(db);
}, "seasons");

const expensesQuery = query(async () => {
  "use server";
  return listExpenses(db).map((e) => ({ id: e.id, date: e.date, detail: e.detail }));
}, "taskExpenses");

const addTask = action(async (form: FormData) => {
  "use server";
  const date = String(form.get("date") ?? "");
  const description = String(form.get("description") ?? "").trim();
  const season = String(form.get("season") ?? "").trim();
  const expenseRaw = form.get("expenseId");
  const expenseId = expenseRaw ? Number(expenseRaw) : undefined;
  if (!date || !description || !season) return { error: "invalid" };
  createTask(db, { date, description, season, expenseId });
  return { ok: true };
}, "addTask");

const toggleTask = action(async (form: FormData) => {
  "use server";
  setTaskStatus(db, Number(form.get("id")), form.get("status") === "done" ? "done" : "pending");
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
  const cell = { padding: "0.4rem 0.6rem", "border-bottom": "1px solid #eee" } as const;
  const thisYear = "2026";

  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "55rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>{t("nav.tasks")}</h1>

      <form
        action={addTask}
        method="post"
        style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap", margin: "1rem 0" }}
      >
        <input type="date" name="date" required />
        <input name="description" placeholder={t("maintenance.description")} required />
        <input
          name="season"
          placeholder={t("maintenance.season")}
          value={thisYear}
          size="6"
          required
        />
        <select name="expenseId">
          <option value="">{t("maintenance.linkExpense")}</option>
          <For each={expenses()}>
            {(e) => (
              <option value={e.id}>
                #{e.id} {e.date} {e.detail ?? ""}
              </option>
            )}
          </For>
        </select>
        <button type="submit">{t("common.save")}</button>
      </form>
      <Show when={adding.result?.error}>
        <p style={{ color: "crimson" }}>{t("maintenance.invalid")}</p>
      </Show>

      {/* Filters (GET, URL-driven) */}
      <form
        method="get"
        style={{ display: "flex", gap: "0.5rem", margin: "1rem 0", color: "#555" }}
      >
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
        <button type="submit">{t("bookings.filter")}</button>
      </form>

      <table style={{ "border-collapse": "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{t("common.date")}</th>
            <th style={cell}>{t("maintenance.season")}</th>
            <th style={cell}>{t("maintenance.description")}</th>
            <th style={cell}>{t("maintenance.status")}</th>
            <th style={cell} />
          </tr>
        </thead>
        <tbody>
          <For
            each={tasks()}
            fallback={
              <tr>
                <td colspan="5" style={cell}>
                  {t("maintenance.empty")}
                </td>
              </tr>
            }
          >
            {(task) => (
              <tr>
                <td style={cell}>{task.date}</td>
                <td style={cell}>{task.season}</td>
                <td style={cell}>
                  {task.description}
                  <Show when={task.expenseId}> · 💶#{task.expenseId}</Show>
                </td>
                <td style={cell}>
                  {task.status === "done" ? t("maintenance.done") : t("maintenance.pending")}
                </td>
                <td style={cell}>
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
    </main>
  );
}
