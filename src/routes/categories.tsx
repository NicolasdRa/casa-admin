import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { For, Show } from "solid-js";
import { CATEGORY_GROUPS, type CategoryGroup, createCategory, listCategories } from "~/db/expenses";
import { db } from "~/db/index";
import { useI18n } from "~/lib/i18n";
import { currentUser, recordAudit } from "~/lib/session";

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role === "user") throw redirect("/"); // managed lists are admin/superadmin (PRD §3.1)
  return me;
}

const categoriesQuery = query(async () => {
  "use server";
  await requireAdmin();
  return listCategories(db);
}, "manageCategories");

const addCategory = action(async (form: FormData) => {
  "use server";
  await requireAdmin();
  const name = String(form.get("name") ?? "").trim();
  const group = String(form.get("group") ?? "") as CategoryGroup;
  if (!name) return { error: "invalid" };
  try {
    createCategory(db, { name, group });
  } catch {
    return { error: "invalid" };
  }
  await recordAudit("create", "category");
  return { ok: true };
}, "addCategory");

export const route = { preload: () => categoriesQuery() };

export default function Categories() {
  const { t } = useI18n();
  const categories = createAsync(() => categoriesQuery(), { initialValue: [] });
  const adding = useSubmission(addCategory);
  const cell = { padding: "0.4rem 0.6rem", "border-bottom": "1px solid #eee" } as const;

  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "36rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>{t("categories.title")}</h1>

      <form
        action={addCategory}
        method="post"
        style={{ display: "flex", gap: "0.5rem", margin: "1rem 0" }}
      >
        <input name="name" placeholder={t("categories.name")} required />
        <select name="group">
          <For each={CATEGORY_GROUPS}>
            {(g) => <option value={g}>{t(`categories.g_${g}`)}</option>}
          </For>
        </select>
        <button type="submit">{t("common.save")}</button>
      </form>
      <Show when={adding.result?.error}>
        <p style={{ color: "crimson" }}>{t("categories.error")}</p>
      </Show>

      <table style={{ "border-collapse": "collapse", width: "100%" }}>
        <tbody>
          <For
            each={categories()}
            fallback={
              <tr>
                <td style={cell}>{t("categories.empty")}</td>
              </tr>
            }
          >
            {(c) => (
              <tr>
                <td style={cell}>{c.name}</td>
                <td style={cell}>{t(`categories.g_${c.group}`)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </main>
  );
}
