import { action, createAsync, query, useSubmission } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { useConfirm } from "~/components/ConfirmProvider";
import { Modal } from "~/components/Modal";
import { db } from "~/db/index";
import { createSupplier, deleteSupplier, listSuppliers, renameSupplier } from "~/db/suppliers";
import { createEntityForm } from "~/lib/createEntityForm";
import { useI18n } from "~/lib/i18n";
import { runMutation } from "~/lib/mutation";
import { requireUser } from "~/lib/session";

const listSuppliersQuery = query(async () => {
  "use server";
  await requireUser();
  return listSuppliers(db);
}, "suppliers");

const addSupplier = action(async (form: FormData) => {
  "use server";
  await requireUser();
  const name = String(form.get("name") ?? "");
  return runMutation({ audit: ["create", "supplier"] }, () => {
    createSupplier(db, name);
  });
}, "addSupplier");

const editSupplier = action(async (form: FormData) => {
  "use server";
  await requireUser();
  const id = Number(form.get("id"));
  const name = String(form.get("name") ?? "");
  return runMutation({ audit: ["update", "supplier"] }, () => {
    renameSupplier(db, id, name);
  });
}, "editSupplier");

const removeSupplier = action(async (form: FormData) => {
  "use server";
  await requireUser();
  const id = Number(form.get("id"));
  return runMutation({ audit: ["delete", "supplier"] }, () => {
    deleteSupplier(db, id);
  });
}, "removeSupplier");

export const route = { preload: () => listSuppliersQuery() };

export default function Suppliers() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const suppliers = createAsync(() => listSuppliersQuery(), { initialValue: [] });
  const adding = useSubmission(addSupplier);
  const editing = useSubmission(editSupplier);
  const removing = useSubmission(removeSupplier);
  const errMsg = (code: string) => t(`suppliers.err_${code}` as Parameters<typeof t>[0]) as string;
  const form = createEntityForm(adding);

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("suppliers.title")}</h1>
        </div>
        <div class="page-head-actions">
          <button type="button" onClick={form.openForm}>
            + {t("suppliers.add")}
          </button>
        </div>
      </header>

      <Modal open={form.open()} onClose={() => form.setOpen(false)} title={t("suppliers.add")}>
        <form ref={form.setRef} action={addSupplier} method="post" class="toolbar entry-form">
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

      {/* Rename/delete used to land silently — confirm the write so the user knows it took. */}
      <Show when={editing.result?.ok || removing.result?.ok}>
        <p class="alert alert-success" role="status">
          {t("common.saved")}
        </p>
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
              {(s) => {
                // Save stays dimmed until the name actually changes — the row reads as data,
                // not a wall of live buttons (DESIGN.md's hover-action intent, touch-safe).
                const [name, setName] = createSignal(s.name);
                const dirty = () => name().trim() !== "" && name().trim() !== s.name;
                return (
                  <tr>
                    <td>
                      <form
                        action={editSupplier}
                        method="post"
                        style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}
                      >
                        <input type="hidden" name="id" value={s.id} />
                        <input
                          name="name"
                          value={s.name}
                          onInput={(e) => setName(e.currentTarget.value)}
                          required
                        />
                        <button type="submit" disabled={!dirty() || editing.pending}>
                          {t("common.save")}
                        </button>
                      </form>
                    </td>
                    <td>
                      <form action={removeSupplier} method="post">
                        <input type="hidden" name="id" value={s.id} />
                        <button
                          type="submit"
                          class="btn-ghost"
                          onClick={async (e) => {
                            e.preventDefault();
                            const form = e.currentTarget.form;
                            if (
                              await confirm({ message: t("suppliers.confirmDelete"), danger: true })
                            ) {
                              form?.requestSubmit();
                            }
                          }}
                        >
                          {t("suppliers.delete")}
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
