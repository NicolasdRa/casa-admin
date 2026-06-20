import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { For, Show } from "solid-js";
import { db } from "~/db/index";
import { createUser, listUsers, updateUser } from "~/db/users";
import { useI18n } from "~/lib/i18n";
import { hashPassword } from "~/lib/password";
import { can, type Role } from "~/lib/permissions";
import { currentUser } from "~/lib/session";

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
  return { ok: true };
}, "addUser");

const editUser = action(async (form: FormData) => {
  "use server";
  await requireManageUsers();
  updateUser(db, Number(form.get("id")), {
    role: toRole(form.get("role")),
    status: form.get("status") === "disabled" ? "disabled" : "active",
  });
  return { ok: true };
}, "editUser");

export default function Users() {
  const { t } = useI18n();
  const users = createAsync(() => usersQuery(), { initialValue: [] });
  const adding = useSubmission(addUser);
  const cell = { padding: "0.4rem 0.6rem", "border-bottom": "1px solid #eee" } as const;
  const roles: Role[] = ["superadmin", "admin", "user"];

  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "55rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>{t("users.title")}</h1>

      <form
        action={addUser}
        method="post"
        style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap", margin: "1rem 0" }}
      >
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
        <p style={{ color: "crimson" }}>{t("users.addError")}</p>
      </Show>

      <table style={{ "border-collapse": "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{t("users.name")}</th>
            <th style={cell}>{t("auth.email")}</th>
            <th style={cell}>{t("users.role")}</th>
            <th style={cell}>{t("users.status")}</th>
            <th style={cell} />
          </tr>
        </thead>
        <tbody>
          <For each={users()}>
            {(u) => (
              <tr>
                <td style={cell}>{u.name}</td>
                <td style={cell}>{u.email}</td>
                <td style={cell} colspan="3">
                  <form action={editUser} method="post" style={{ display: "flex", gap: "0.5rem" }}>
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
    </main>
  );
}
