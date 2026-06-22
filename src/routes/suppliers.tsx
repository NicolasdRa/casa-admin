import { action, createAsync, query, useSubmission } from "@solidjs/router";
import { createEffect, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { Modal } from "~/components/Modal";
import { db } from "~/db/index";
import { createSupplier, deleteSupplier, listSuppliers, renameSupplier } from "~/db/suppliers";
import { useI18n } from "~/lib/i18n";
import { recordAudit, requireUser } from "~/lib/session";

// Map a thrown supplier error to a stable i18n suffix (suppliers.err_*) — raw exception text
// never reaches the user.
const SUPPLIER_ERROR_PREFIXES: [string, string][] = [
  ["supplier name required", "nameRequired"],
  ["already exists", "duplicate"],
  ["in use", "inUse"],
];
function supplierErrorCode(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return SUPPLIER_ERROR_PREFIXES.find(([k]) => m.includes(k))?.[1] ?? "generic";
}

const listSuppliersQuery = query(async () => {
  "use server";
  await requireUser();
  return listSuppliers(db);
}, "suppliers");

const addSupplier = action(async (form: FormData) => {
  "use server";
  await requireUser();
  const name = String(form.get("name") ?? "");
  try {
    createSupplier(db, name);
  } catch (e) {
    return { error: supplierErrorCode(e) };
  }
  await recordAudit("create", "supplier");
  return { ok: true };
}, "addSupplier");

const editSupplier = action(async (form: FormData) => {
  "use server";
  await requireUser();
  const id = Number(form.get("id"));
  const name = String(form.get("name") ?? "");
  try {
    renameSupplier(db, id, name);
  } catch (e) {
    return { error: supplierErrorCode(e) };
  }
  await recordAudit("update", "supplier");
  return { ok: true };
}, "editSupplier");

const removeSupplier = action(async (form: FormData) => {
  "use server";
  await requireUser();
  const id = Number(form.get("id"));
  try {
    deleteSupplier(db, id);
  } catch (e) {
    return { error: supplierErrorCode(e) };
  }
  await recordAudit("delete", "supplier");
  return { ok: true };
}, "removeSupplier");

export const route = { preload: () => listSuppliersQuery() };

export default function Suppliers() {
  const { t } = useI18n();
  const suppliers = createAsync(() => listSuppliersQuery(), { initialValue: [] });
  const adding = useSubmission(addSupplier);
  const editing = useSubmission(editSupplier);
  const removing = useSubmission(removeSupplier);
  const errMsg = (code: string) => t(`suppliers.err_${code}` as Parameters<typeof t>[0]) as string;
  const [formOpen, setFormOpen] = createSignal(false);
  let formEl: HTMLFormElement | undefined;
  createEffect(() => {
    if (adding.result?.ok) formEl?.reset();
  });

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("suppliers.title")}</h1>
        </div>
        <div class="page-head-actions">
          <button
            type="button"
            onClick={() => {
              adding.clear?.();
              setFormOpen(true);
            }}
          >
            + {t("suppliers.add")}
          </button>
        </div>
      </header>

      <Modal open={formOpen()} onClose={() => setFormOpen(false)} title={t("suppliers.add")}>
        <form ref={formEl} action={addSupplier} method="post" class="toolbar entry-form">
          <label class="tb-field tb-grow">
            <span>{t("suppliers.name")}</span>
            <input name="name" required />
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

      <div class="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("suppliers.name")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For
              each={suppliers()}
              fallback={
                <tr>
                  <td class="note" colspan="2">
                    {t("suppliers.empty")}
                  </td>
                </tr>
              }
            >
              {(s) => (
                <tr>
                  <td>
                    <form
                      action={editSupplier}
                      method="post"
                      style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}
                    >
                      <input type="hidden" name="id" value={s.id} />
                      <input name="name" value={s.name} required />
                      <button type="submit">{t("common.save")}</button>
                    </form>
                  </td>
                  <td>
                    <form action={removeSupplier} method="post">
                      <input type="hidden" name="id" value={s.id} />
                      <button
                        type="submit"
                        class="btn-ghost"
                        onClick={(e) => {
                          if (!confirm(t("suppliers.confirmDelete"))) e.preventDefault();
                        }}
                      >
                        {t("suppliers.delete")}
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
