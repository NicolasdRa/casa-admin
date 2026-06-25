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
import { listExpenses } from "~/db/expenses";
import { db } from "~/db/index";
import {
  createTask,
  deleteTask,
  editTask,
  listSeasons,
  listTasks,
  setTaskStatus,
} from "~/db/maintenance";
import { createEntityForm } from "~/lib/createEntityForm";
import { useI18n } from "~/lib/i18n";
import { runMutation } from "~/lib/mutation";
import { currentUser, recordAudit, requireUser } from "~/lib/session";

interface Filter {
  season?: string;
  status?: "pending" | "done";
}

type Task = ReturnType<typeof listTasks>[number];

// Edit/delete are superadmin-only (CA-127); add + status toggle stay open to any signed-in user.
async function requireSuperadmin() {
  const me = await currentUser();
  if (me?.role !== "superadmin") throw redirect("/");
  return me;
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

const canManageQuery = query(async () => {
  "use server";
  const me = await currentUser();
  return !!me && me.role === "superadmin";
}, "tasksCanManage");

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
  if (!description || !season) return { error: "invalid" };
  createTask(db, { date: date || null, description, season, expenseId });
  await recordAudit("create", "maintenanceTask");
  return { ok: true };
}, "addTask");

const editTaskAction = action(async (form: FormData) => {
  "use server";
  await requireSuperadmin();
  const id = Number(form.get("id"));
  const date = String(form.get("date") ?? "");
  const description = String(form.get("description") ?? "");
  const season = String(form.get("season") ?? "").trim();
  const expenseRaw = form.get("expenseId");
  const expenseId = expenseRaw ? Number(expenseRaw) : null;
  return runMutation({ audit: ["update", "maintenanceTask"] }, () => {
    editTask(db, id, { date: date || null, description, season, expenseId });
  });
}, "editTask");

const removeTask = action(async (form: FormData) => {
  "use server";
  await requireSuperadmin();
  const id = Number(form.get("id"));
  return runMutation({ audit: ["delete", "maintenanceTask"] }, () => {
    deleteTask(db, id);
  });
}, "removeTask");

const toggleTask = action(async (form: FormData) => {
  "use server";
  await requireUser();
  setTaskStatus(db, Number(form.get("id")), form.get("status") === "done" ? "done" : "pending");
  await recordAudit("update", "maintenanceTask");
  return { ok: true };
}, "toggleTask");

// Dismiss the native popover a menu button lives in — top-layer menus don't close on inner clicks.
function closePopover(el: HTMLElement) {
  el.closest<HTMLElement>("[popover]")?.hidePopover();
}

export default function Maintenance() {
  const { t } = useI18n();
  const confirm = useConfirm();
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
  const canManage = createAsync(() => canManageQuery(), { initialValue: false });
  const expenses = createAsync(() => expensesQuery(), { initialValue: [] });
  const adding = useSubmission(addTask);
  const editing = useSubmission(editTaskAction);
  const removing = useSubmission(removeTask);
  const thisYear = String(new Date().getFullYear());
  const form = createEntityForm(adding);
  // The task whose edit modal is open (null = closed); holds the row so the form pre-fills.
  const [editTarget, setEditTarget] = createSignal<Task | null>(null);
  createEffect(() => {
    if (editing.result?.ok) setEditTarget(null);
  });

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
            <input type="date" name="date" />
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

      {/* Edit modal — pre-filled with the row's current values (superadmin only). */}
      <Modal
        open={editTarget() != null}
        onClose={() => setEditTarget(null)}
        title={t("maintenance.editTitle")}
      >
        <Show when={editTarget()}>
          {(task) => (
            <form action={editTaskAction} method="post" class="toolbar entry-form">
              <input type="hidden" name="id" value={task().id} />
              <label class="tb-field">
                <span>{t("common.date")}</span>
                <input type="date" name="date" value={task().date ?? ""} />
              </label>
              <label class="tb-field tb-grow">
                <span>{t("maintenance.description")}</span>
                <input name="description" value={task().description} required />
              </label>
              <label class="tb-field">
                <span>{t("maintenance.season")}</span>
                <input name="season" value={task().season} size="6" required />
              </label>
              <label class="tb-field tb-grow">
                <span>{t("maintenance.linkExpense")}</span>
                <select name="expenseId">
                  <option value="">—</option>
                  <For each={expenses()}>
                    {(e) => (
                      <option value={e.id} selected={e.id === task().expenseId}>
                        #{e.id} {e.date} {e.detail ?? ""}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <button type="submit" disabled={editing.pending}>
                {editing.pending ? t("common.saving") : t("common.save")}
              </button>
              <Show when={editing.result?.error}>
                <p class="alert alert-error" role="alert">
                  {t("maintenance.invalid")}
                </p>
              </Show>
            </form>
          )}
        </Show>
      </Modal>

      <Show when={editing.result?.ok || removing.result?.ok}>
        <p class="alert alert-success" role="status">
          {t("common.saved")}
        </p>
      </Show>

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
              <th class="col-actions">
                <span class="sr-only">{t("common.actions")}</span>
              </th>
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
                  <td>{task.date ?? "—"}</td>
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
                  {/* Row action menu (⋯): toggle status (any user), edit + delete (superadmin).
                      Native Popover API → top layer, so the dropdown is never clipped by the table. */}
                  <td class="col-actions" data-label={t("common.actions")}>
                    <button
                      type="button"
                      class="row-menu-trigger"
                      aria-label={t("common.actions")}
                      popovertarget={`task-menu-${task.id}`}
                      style={{ "anchor-name": `--task-menu-${task.id}` }}
                    >
                      ⋯
                    </button>
                    <div
                      id={`task-menu-${task.id}`}
                      popover="auto"
                      class="menu-pop"
                      style={{ "position-anchor": `--task-menu-${task.id}` }}
                    >
                      <form action={toggleTask} method="post">
                        <input type="hidden" name="id" value={task.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={task.status === "done" ? "pending" : "done"}
                        />
                        <button
                          type="submit"
                          class="menu-item"
                          onClick={(ev) => closePopover(ev.currentTarget)}
                        >
                          {task.status === "done"
                            ? t("maintenance.markPending")
                            : t("maintenance.markDone")}
                        </button>
                      </form>
                      <Show when={canManage()}>
                        <button
                          type="button"
                          class="menu-item"
                          onClick={(ev) => {
                            editing.clear?.(); // fresh modal — no stale error banner
                            setEditTarget(task);
                            closePopover(ev.currentTarget);
                          }}
                        >
                          {t("common.edit")}
                        </button>
                        <form action={removeTask} method="post">
                          <input type="hidden" name="id" value={task.id} />
                          <button
                            type="submit"
                            class="menu-item"
                            onClick={async (ev) => {
                              ev.preventDefault();
                              const button = ev.currentTarget;
                              const f = button.form;
                              if (
                                await confirm({
                                  message: t("maintenance.confirmDelete"),
                                  danger: true,
                                })
                              ) {
                                closePopover(button);
                                f?.requestSubmit();
                              }
                            }}
                          >
                            {t("maintenance.delete")}
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
