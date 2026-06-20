import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { db } from "~/db/index";
import { createUser, getUserById, listUsers, updateUser } from "~/db/users";
import { useI18n } from "~/lib/i18n";
import { hashPassword } from "~/lib/password";
import { can, type Role, userEditError } from "~/lib/permissions";
import { currentUser, recordAudit } from "~/lib/session";

async function requireManageUsers() {
  const me = await currentUser();
  if (!me || !can(me.role, "manageUsers")) throw redirect("/");
  return me;
}

const toRole = (v: FormDataEntryValue | null): Role =>
  v === "superadmin" || v === "admin" ? v : "user";

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
  const activeSuperadmins = listUsers(db).filter(
    (u) => u.role === "superadmin" && u.status === "active",
  ).length;
  const err = userEditError(me, target, next, activeSuperadmins);
  if (err) return { error: err };
  updateUser(db, target.id, next);
  await recordAudit("update", `user:${target.id}`);
  return { ok: true };
}, "editUser");

export default function Users() {
  const { t } = useI18n();
  const users = createAsync(() => usersQuery(), { initialValue: [] });
  const adding = useSubmission(addUser);
  const editing = useSubmission(editUser);
  const roles: Role[] = ["superadmin", "admin", "user"];

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("users.title")}</h1>
        </div>
      </header>

      <form action={addUser} method="post" class="toolbar">
        <input name="name" placeholder={t("users.name")} required />
        <input type="email" name="email" placeholder={t("auth.email")} required />
        <input
          type="password"
          name="password"
          placeholder={t("auth.password")}
          required
          minlength="8"
        />
        <select name="role">
          <For each={roles}>{(r) => <option value={r}>{t(`users.role_${r}`)}</option>}</For>
        </select>
        <select name="locale">
          <option value="es">ES</option>
          <option value="en">EN</option>
        </select>
        <button type="submit">{t("common.save")}</button>
      </form>
      <Show when={adding.result?.error}>
        <p class="alert alert-error">{t("users.addError")}</p>
      </Show>
      <Show when={editing.result?.error}>
        <p class="alert alert-error">{t("users.editError")}</p>
      </Show>

      <div class="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("users.name")}</th>
              <th>{t("auth.email")}</th>
              <th>{t("users.role")}</th>
              <th>{t("users.status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={users()}>
              {(u) => (
                <tr>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td colspan="3">
                    <form
                      action={editUser}
                      method="post"
                      style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}
                    >
                      <input type="hidden" name="id" value={u.id} />
                      <select name="role">
                        <For each={roles}>
                          {(r) => (
                            <option value={r} selected={r === u.role}>
                              {t(`users.role_${r}`)}
                            </option>
                          )}
                        </For>
                      </select>
                      <select name="status">
                        <option value="active" selected={u.status === "active"}>
                          {t("users.active")}
                        </option>
                        <option value="disabled" selected={u.status === "disabled"}>
                          {t("users.disabled")}
                        </option>
                      </select>
                      <button type="submit">{t("common.save")}</button>
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
