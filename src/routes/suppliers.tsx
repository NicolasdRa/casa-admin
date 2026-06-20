import { action, createAsync, query, useSubmission } from "@solidjs/router";
import { For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { db } from "~/db/index";
import { createSupplier, listSuppliers } from "~/db/suppliers";
import { useI18n } from "~/lib/i18n";
import { recordAudit, requireUser } from "~/lib/session";

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
    return { error: (e as Error).message };
  }
  await recordAudit("create", "supplier");
  return { ok: true };
}, "addSupplier");

export const route = { preload: () => listSuppliersQuery() };

export default function Suppliers() {
  const { t } = useI18n();
  const suppliers = createAsync(() => listSuppliersQuery(), { initialValue: [] });
  const submission = useSubmission(addSupplier);

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("suppliers.title")}</h1>
        </div>
      </header>

      <form action={addSupplier} method="post" class="toolbar">
        <input name="name" placeholder={t("suppliers.name")} required />
        <button type="submit">{t("common.save")}</button>
      </form>

      <Show when={submission.result?.error}>
        {(err) => <p class="alert alert-error">{err()}</p>}
      </Show>

      <div class="panel">
        <table>
          <tbody>
            <For
              each={suppliers()}
              fallback={
                <tr>
                  <td class="note">{t("suppliers.empty")}</td>
                </tr>
              }
            >
              {(s) => (
                <tr>
                  <td>{s.name}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
