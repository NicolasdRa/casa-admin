import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { createEffect, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { Modal } from "~/components/Modal";
import {
  CATEGORY_GROUPS,
  type CategoryGroup,
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
} from "~/db/expenses";
import { db } from "~/db/index";
import { errorCode } from "~/lib/errors";
import { useI18n } from "~/lib/i18n";
import { currentUser, recordAudit } from "~/lib/session";

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role === "user") throw redirect("/"); // managed lists are admin/superadmin (PRD §3.1)
  return me;
}

// Thrown-message → categories.err_* suffix table. Raw exception text never reaches the user.
const CATEGORY_ERROR_NEEDLES: [string, string][] = [
  ["category name required", "nameRequired"],
  ["invalid category group", "invalidGroup"],
  ["in use", "inUse"],
];
const categoryErrorCode = (e: unknown) => errorCode(e, CATEGORY_ERROR_NEEDLES);

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
  if (!name) return { error: "nameRequired" };
  try {
    createCategory(db, { name, group });
  } catch (e) {
    return { error: categoryErrorCode(e) };
  }
  await recordAudit("create", "category");
  return { ok: true };
}, "addCategory");

const editCategory = action(async (form: FormData) => {
  "use server";
  await requireAdmin();
  const id = Number(form.get("id"));
  const name = String(form.get("name") ?? "");
  try {
    renameCategory(db, id, name);
  } catch (e) {
    return { error: categoryErrorCode(e) };
  }
  await recordAudit("update", "category");
  return { ok: true };
}, "editCategory");

const removeCategory = action(async (form: FormData) => {
  "use server";
  await requireAdmin();
  const id = Number(form.get("id"));
  try {
    deleteCategory(db, id);
  } catch (e) {
    return { error: categoryErrorCode(e) };
  }
  await recordAudit("delete", "category");
  return { ok: true };
}, "removeCategory");

export const route = { preload: () => categoriesQuery() };

export default function Categories() {
  const { t } = useI18n();
  const categories = createAsync(() => categoriesQuery(), { initialValue: [] });
  const adding = useSubmission(addCategory);
  const editing = useSubmission(editCategory);
  const removing = useSubmission(removeCategory);
  const errMsg = (code: string) => t(`categories.err_${code}` as Parameters<typeof t>[0]) as string;
  const [formOpen, setFormOpen] = createSignal(false);
  let formEl: HTMLFormElement | undefined;
  createEffect(() => {
    if (adding.result?.ok) formEl?.reset();
  });

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("categories.title")}</h1>
        </div>
        <div class="page-head-actions">
          <button
            type="button"
            onClick={() => {
              adding.clear?.();
              setFormOpen(true);
            }}
          >
            + {t("categories.add")}
          </button>
        </div>
      </header>

      <Modal open={formOpen()} onClose={() => setFormOpen(false)} title={t("categories.add")}>
        <form ref={formEl} action={addCategory} method="post" class="toolbar entry-form">
          <label class="tb-field tb-grow">
            <span>{t("categories.name")}</span>
            <input name="name" required />
          </label>
          <label class="tb-field">
            <span>{t("categories.group")}</span>
            <select name="group">
              <For each={CATEGORY_GROUPS}>
                {(g) => <option value={g}>{t(`categories.g_${g}`)}</option>}
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
          {(err) => (
            <p class="alert alert-error" role="alert">
              {errMsg(err())}
            </p>
          )}
        </Show>
      </Modal>

      <Show when={editing.result?.error ?? removing.result?.error}>
        {(err) => (
          <p class="alert alert-error" role="alert">
            {errMsg(err())}
          </p>
        )}
      </Show>
      <Show when={editing.result?.ok || removing.result?.ok}>
        <p class="alert alert-success" role="status">
          {t("common.saved")}
        </p>
      </Show>

      <div class="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("categories.name")}</th>
              <th>{t("categories.group")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For
              each={categories()}
              fallback={
                <tr>
                  <td class="note" colspan="3">
                    {t("categories.empty")}
                  </td>
                </tr>
              }
            >
              {(c) => {
                // Save stays dimmed until the name changes — rows read as data, not live buttons.
                const [name, setName] = createSignal(c.name);
                const dirty = () => name().trim() !== "" && name().trim() !== c.name;
                return (
                  <tr>
                    <td>
                      <form
                        action={editCategory}
                        method="post"
                        style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}
                      >
                        <input type="hidden" name="id" value={c.id} />
                        <input
                          name="name"
                          value={c.name}
                          onInput={(e) => setName(e.currentTarget.value)}
                          required
                        />
                        <button type="submit" disabled={!dirty() || editing.pending}>
                          {t("common.save")}
                        </button>
                      </form>
                    </td>
                    <td>{t(`categories.g_${c.group}`)}</td>
                    <td>
                      <form action={removeCategory} method="post">
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          type="submit"
                          class="btn-ghost"
                          onClick={(e) => {
                            if (!confirm(t("categories.confirmDelete"))) e.preventDefault();
                          }}
                        >
                          {t("categories.delete")}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
