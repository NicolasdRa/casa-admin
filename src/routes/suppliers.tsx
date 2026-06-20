import { action, createAsync, query, useSubmission } from "@solidjs/router";
import { For, Show } from "solid-js";
import { db } from "~/db/index";
import { createSupplier, listSuppliers } from "~/db/suppliers";
import { useI18n } from "~/lib/i18n";

const listSuppliersQuery = query(async () => {
  "use server";
  return listSuppliers(db);
}, "suppliers");

const addSupplier = action(async (form: FormData) => {
  "use server";
  const name = String(form.get("name") ?? "");
  try {
    createSupplier(db, name);
  } catch (e) {
    return { error: (e as Error).message };
  }
  return { ok: true };
}, "addSupplier");

export const route = { preload: () => listSuppliersQuery() };

export default function Suppliers() {
  const { t } = useI18n();
  const suppliers = createAsync(() => listSuppliersQuery(), { initialValue: [] });
  const submission = useSubmission(addSupplier);

  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "40rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>{t("suppliers.title")}</h1>

      <form
        action={addSupplier}
        method="post"
        style={{ display: "flex", gap: "0.5rem", margin: "1rem 0" }}
      >
        <input name="name" placeholder={t("suppliers.name")} required />
        <button type="submit">{t("common.save")}</button>
      </form>

      <Show when={submission.result?.error}>
        {(err) => <p style={{ color: "crimson" }}>{err()}</p>}
      </Show>

      <ul>
        <For each={suppliers()} fallback={<li>{t("suppliers.empty")}</li>}>
          {(s) => <li>{s.name}</li>}
        </For>
      </ul>
    </main>
  );
}
