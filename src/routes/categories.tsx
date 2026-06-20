import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
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

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("categories.title")}</h1>
        </div>
      </header>

      <form action={addCategory} method="post" class="toolbar">
        <input name="name" placeholder={t("categories.name")} required />
        <select name="group">
          <For each={CATEGORY_GROUPS}>
            {(g) => <option value={g}>{t(`categories.g_${g}`)}</option>}
          </For>
        </select>
        <button type="submit">{t("common.save")}</button>
      </form>
      <Show when={adding.result?.error}>
        <p class="alert alert-error">{t("categories.error")}</p>
      </Show>

      <div class="panel">
        <table>
          <tbody>
            <For
              each={categories()}
              fallback={
                <tr>
                  <td class="note">{t("categories.empty")}</td>
                </tr>
              }
            >
              {(c) => (
                <tr>
                  <td>{c.name}</td>
                  <td>{t(`categories.g_${c.group}`)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
