import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { useConfirm } from "~/components/ConfirmProvider";
import { Modal } from "~/components/Modal";
import { db } from "~/db/index";
import {
  createUser,
  deleteUser,
  deleteUsers,
  getUserById,
  listUsers,
  setPassword,
  updateUser,
} from "~/db/users";
import { createEntityForm } from "~/lib/createEntityForm";
import { errorCode } from "~/lib/errors";
import { useI18n } from "~/lib/i18n";
import { hashPassword } from "~/lib/password";
import { can, type Role, userDeleteError, userEditError } from "~/lib/permissions";
import { currentUser, recordAudit } from "~/lib/session";

type User = Omit<ReturnType<typeof listUsers>[number], "passwordHash">;

// manageUsers is superadmin-only — the whole route (view + every action) is gated to it, so unlike
// suppliers there's no in-page "can manage" split: anyone who sees this page can manage.
async function requireManageUsers() {
  const me = await currentUser();
  if (!me || !can(me.role, "manageUsers")) throw redirect("/");
  return me;
}

const toRole = (v: FormDataEntryValue | null): Role =>
  v === "superadmin" || v === "admin" ? v : "user";

// Count of superadmins still active — the lockout guards compare against this.
const countActiveSuperadmins = () =>
  listUsers(db).filter((u) => u.role === "superadmin" && u.status === "active").length;

const usersQuery = query(async () => {
  "use server";
  await requireManageUsers();
  return listUsers(db).map(({ passwordHash: _omit, ...rest }) => rest);
}, "users");

const addUser = action(async (form: FormData) => {
  "use server";
  await requireManageUsers();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!name || !email || password.length < 8) return { error: "invalid" };
  try {
    createUser(db, {
      name,
      email,
      passwordHash: hashPassword(password),
      role: toRole(form.get("role")),
      locale: form.get("locale") === "en" ? "en" : "es",
    });
  } catch {
    return { error: "duplicate" };
  }
  await recordAudit("create", "user");
  return { ok: true };
}, "addUser");

const editUser = action(async (form: FormData) => {
  "use server";
  const me = await requireManageUsers();
  const target = getUserById(db, Number(form.get("id")));
  if (!target) return { error: "notfound" };
  const next = {
    role: toRole(form.get("role")),
    status: form.get("status") === "disabled" ? ("disabled" as const) : ("active" as const),
  };
  const err = userEditError(me, target, next, countActiveSuperadmins());
  if (err) return { error: err };
  updateUser(db, target.id, next);
  await recordAudit("update", `user:${target.id}`);
  return { ok: true };
}, "editUser");

const removeUser = action(async (form: FormData) => {
  "use server";
  const me = await requireManageUsers();
  const id = Number(form.get("id"));
  const target = getUserById(db, id);
  if (!target) return { error: "notfound" };
  const err = userDeleteError(me.id, [target], countActiveSuperadmins());
  if (err) return { error: err };
  try {
    deleteUser(db, id); // throws CodedError("inUse") if the account has expense/audit history
  } catch (e) {
    return { error: errorCode(e, []) };
  }
  await recordAudit("delete", `user:${id}`);
  return { ok: true };
}, "removeUser");

const bulkRemoveUsers = action(async (form: FormData) => {
  "use server";
  const me = await requireManageUsers();
  const ids = form.getAll("id").map(Number);
  const targets = ids.map((id) => getUserById(db, id)).filter((u) => u != null);
  const err = userDeleteError(me.id, targets, countActiveSuperadmins());
  if (err) return { error: err };
  try {
    deleteUsers(db, ids); // all-or-nothing — rolls back if any id still has history
  } catch (e) {
    return { error: errorCode(e, []) };
  }
  await recordAudit("delete", "user");
  return { ok: true };
}, "bulkRemoveUsers");

// Reset a user's password. manageUsers is superadmin-only, so the actor is always a peer with the
// authority to do this; the only check is a minimum length. The hash never round-trips to the client.
const resetPassword = action(async (form: FormData) => {
  "use server";
  await requireManageUsers();
  const id = Number(form.get("id"));
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "passwordShort" };
  const target = getUserById(db, id);
  if (!target) return { error: "notfound" };
  setPassword(db, id, hashPassword(password));
  await recordAudit("update", `user:${id}:password`);
  return { ok: true };
}, "resetPassword");

export const route = { preload: () => usersQuery() };

// Dismiss the native popover a menu button lives in — top-layer menus don't close on inner clicks.
function closePopover(el: HTMLElement) {
  el.closest<HTMLElement>("[popover]")?.hidePopover();
}

export default function Users() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const users = createAsync(() => usersQuery(), { initialValue: [] });
  const adding = useSubmission(addUser);
  const editing = useSubmission(editUser);
  const removing = useSubmission(removeUser);
  const bulkRemoving = useSubmission(bulkRemoveUsers);
  const resetting = useSubmission(resetPassword);
  // Map a returned code (incl. the userEditError/userDeleteError reasons) to a localized message.
  const errMsg = (code: string) => t(`users.err_${code}` as Parameters<typeof t>[0]) as string;
  const roles: Role[] = ["superadmin", "admin", "user"];
  const form = createEntityForm(adding);
  // The user whose edit modal is open (null = closed); holds the row so the form pre-fills.
  const [editTarget, setEditTarget] = createSignal<User | null>(null);
  // The user whose password-reset modal is open (null = closed).
  const [resetUser, setResetUser] = createSignal<{ id: number; name: string } | null>(null);
  // Close each modal once its submission lands.
  createEffect(() => {
    if (editing.result?.ok) setEditTarget(null);
  });
  createEffect(() => {
    if (resetting.result?.ok) setResetUser(null);
  });

  // Filter + sort are client-side: the list is tiny and already loaded, so a round-trip would only
  // add latency. Bulk selection is held as a Set of ids.
  const [q, setQ] = createSignal("");
  const [sortDir, setSortDir] = createSignal<"asc" | "desc">("asc");
  const [selected, setSelected] = createSignal<Set<number>>(new Set());

  const view = createMemo(() => {
    const needle = q().trim().toLowerCase();
    const rows = users().filter(
      (u) => u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle),
    );
    const dir = sortDir() === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => dir * a.name.localeCompare(b.name));
  });

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  // Select-all toggles the *visible* rows only — selection respects the active filter.
  const allVisibleSelected = () => view().length > 0 && view().every((u) => selected().has(u.id));
  const toggleAll = () =>
    setSelected(allVisibleSelected() ? new Set<number>() : new Set(view().map((u) => u.id)));

  // Clear the selection once a bulk delete lands so the (now-gone) ids don't linger.
  createEffect(() => {
    if (bulkRemoving.result?.ok) setSelected(new Set<number>());
  });

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("users.title")}</h1>
        </div>
        <div class="page-head-actions">
          <button type="button" onClick={form.openForm}>
            + {t("users.add")}
          </button>
        </div>
      </header>

      <Modal open={form.open()} onClose={() => form.setOpen(false)} title={t("users.add")}>
        <form ref={form.setRef} action={addUser} method="post" class="toolbar entry-form">
          <label class="tb-field tb-grow">
            <span>{t("users.name")}</span>
            <input name="name" required />
          </label>
          <label class="tb-field tb-grow">
            <span>{t("auth.email")}</span>
            <input type="email" name="email" required />
          </label>
          <label class="tb-field tb-grow">
            <span>{t("auth.password")}</span>
            <input type="password" name="password" required minlength="8" />
          </label>
          <label class="tb-field">
            <span>{t("users.role")}</span>
            <select name="role">
              <For each={roles}>{(r) => <option value={r}>{t(`users.role_${r}`)}</option>}</For>
            </select>
          </label>
          <label class="tb-field">
            <span>{t("settings.locale")}</span>
            <select name="locale">
              <option value="es">ES</option>
              <option value="en">EN</option>
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
          {(err) => (
            <p class="alert alert-error" role="alert">
              {errMsg(err())}
            </p>
          )}
        </Show>
      </Modal>

      {/* Edit modal — role + status, pre-filled with the row's current values. */}
      <Modal
        open={editTarget() != null}
        onClose={() => setEditTarget(null)}
        title={t("users.editTitle")}
      >
        <Show when={editTarget()}>
          {(u) => (
            <form action={editUser} method="post" class="toolbar entry-form">
              <input type="hidden" name="id" value={u().id} />
              <p class="note-faint">
                {u().name} · {u().email}
              </p>
              <label class="tb-field">
                <span>{t("users.role")}</span>
                <select name="role">
                  <For each={roles}>
                    {(r) => (
                      <option value={r} selected={r === u().role}>
                        {t(`users.role_${r}`)}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <label class="tb-field">
                <span>{t("users.status")}</span>
                <select name="status">
                  <option value="active" selected={u().status === "active"}>
                    {t("users.active")}
                  </option>
                  <option value="disabled" selected={u().status === "disabled"}>
                    {t("users.disabled")}
                  </option>
                </select>
              </label>
              <button type="submit" disabled={editing.pending}>
                {editing.pending ? t("common.saving") : t("common.save")}
              </button>
              <Show when={editing.result?.error}>
                {(err) => (
                  <p class="alert alert-error" role="alert">
                    {errMsg(err())}
                  </p>
                )}
              </Show>
            </form>
          )}
        </Show>
      </Modal>

      {/* Password reset — a modal so credential entry isn't inline row noise. */}
      <Modal
        open={resetUser() != null}
        onClose={() => setResetUser(null)}
        title={t("users.resetPassword")}
      >
        <Show when={resetUser()}>
          {(u) => (
            <form action={resetPassword} method="post" class="toolbar entry-form">
              <input type="hidden" name="id" value={u().id} />
              <p class="note-faint">{u().name}</p>
              <label class="tb-field tb-grow">
                <span>{t("users.newPassword")}</span>
                <input
                  type="password"
                  name="password"
                  required
                  minlength="8"
                  autocomplete="new-password"
                />
              </label>
              <button type="submit" disabled={resetting.pending}>
                {resetting.pending ? t("common.saving") : t("users.resetPassword")}
              </button>
              <Show when={resetting.result?.error}>
                {(err) => (
                  <p class="alert alert-error" role="alert">
                    {errMsg(err())}
                  </p>
                )}
              </Show>
            </form>
          )}
        </Show>
      </Modal>

      <Show when={editing.result?.error ?? removing.result?.error ?? bulkRemoving.result?.error}>
        {(err) => (
          <p class="alert alert-error" role="alert">
            {errMsg(err())}
          </p>
        )}
      </Show>
      <Show
        when={
          editing.result?.ok ||
          removing.result?.ok ||
          bulkRemoving.result?.ok ||
          resetting.result?.ok
        }
      >
        <p class="alert alert-success" role="status">
          {t("common.saved")}
        </p>
      </Show>

      <div class="toolbar filter">
        <input
          type="search"
          placeholder={t("users.filter")}
          value={q()}
          onInput={(e) => setQ(e.currentTarget.value)}
          aria-label={t("users.filter")}
        />
        {/* Bulk action bar appears only with a live selection — no dead buttons otherwise. */}
        <Show when={selected().size > 0}>
          <span class="toolbar-label">
            {selected().size} {t("users.selected")}
          </span>
          <form action={bulkRemoveUsers} method="post">
            <For each={[...selected()]}>{(id) => <input type="hidden" name="id" value={id} />}</For>
            <button
              type="submit"
              class="btn-ghost"
              disabled={bulkRemoving.pending}
              onClick={async (e) => {
                e.preventDefault();
                const f = e.currentTarget.form;
                if (await confirm({ message: t("users.confirmDeleteSelected"), danger: true })) {
                  f?.requestSubmit();
                }
              }}
            >
              {t("users.deleteSelected")}
            </button>
          </form>
        </Show>
      </div>

      <div class="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th class="col-check">
                <input
                  type="checkbox"
                  checked={allVisibleSelected()}
                  onChange={toggleAll}
                  aria-label={t("common.actions")}
                />
              </th>
              <th>
                <button
                  type="button"
                  class="th-sort"
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                >
                  {t("users.name")}{" "}
                  <span aria-hidden="true">{sortDir() === "asc" ? "▲" : "▼"}</span>
                </button>
              </th>
              <th>{t("auth.email")}</th>
              <th>{t("users.role")}</th>
              <th>{t("users.status")}</th>
              <th class="col-actions">
                <span class="sr-only">{t("common.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <For
              each={view()}
              fallback={
                <tr>
                  <td class="note" colspan="6">
                    {users().length === 0 ? t("users.empty") : t("users.noMatch")}
                  </td>
                </tr>
              }
            >
              {(u) => (
                <tr>
                  <td class="col-check">
                    <input
                      type="checkbox"
                      checked={selected().has(u.id)}
                      onChange={() => toggle(u.id)}
                      aria-label={u.name}
                    />
                  </td>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{t(`users.role_${u.role}`)}</td>
                  <td>{u.status === "active" ? t("users.active") : t("users.disabled")}</td>
                  {/* Row action menu (⋯): edit, reset password, delete. Native Popover API → top
                      layer, so the dropdown is never clipped by the table; anchor ties it to this row. */}
                  <td class="col-actions" data-label={t("common.actions")}>
                    <button
                      type="button"
                      class="row-menu-trigger"
                      aria-label={t("common.actions")}
                      popovertarget={`user-menu-${u.id}`}
                      style={{ "anchor-name": `--user-menu-${u.id}` }}
                    >
                      ⋯
                    </button>
                    <div
                      id={`user-menu-${u.id}`}
                      popover="auto"
                      class="menu-pop"
                      style={{ "position-anchor": `--user-menu-${u.id}` }}
                    >
                      <button
                        type="button"
                        class="menu-item"
                        onClick={(ev) => {
                          editing.clear?.(); // fresh modal — no stale error banner
                          setEditTarget(u);
                          closePopover(ev.currentTarget);
                        }}
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        type="button"
                        class="menu-item"
                        onClick={(ev) => {
                          resetting.clear?.();
                          setResetUser({ id: u.id, name: u.name });
                          closePopover(ev.currentTarget);
                        }}
                      >
                        {t("users.resetPassword")}
                      </button>
                      <form action={removeUser} method="post">
                        <input type="hidden" name="id" value={u.id} />
                        <button
                          type="submit"
                          class="menu-item"
                          onClick={async (ev) => {
                            ev.preventDefault();
                            const button = ev.currentTarget;
                            const f = button.form;
                            if (
                              await confirm({ message: t("users.confirmDelete"), danger: true })
                            ) {
                              closePopover(button);
                              f?.requestSubmit();
                            }
                          }}
                        >
                          {t("users.delete")}
                        </button>
                      </form>
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
