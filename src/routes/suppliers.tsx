import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { useConfirm } from "~/components/ConfirmProvider";
import { Modal } from "~/components/Modal";
import { db } from "~/db/index";
import {
  createSupplier,
  deleteSupplier,
  deleteSuppliers,
  listSuppliers,
  renameSupplier,
} from "~/db/suppliers";
import { createEntityForm } from "~/lib/createEntityForm";
import { useI18n } from "~/lib/i18n";
import { runMutation } from "~/lib/mutation";
import { currentUser, requireUser } from "~/lib/session";

type Supplier = ReturnType<typeof listSuppliers>[number];

// Edit/delete are admin/superadmin only (CA-113); the list stays readable by any signed-in user.
async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role === "user") throw redirect("/");
  return me;
}

const listSuppliersQuery = query(async () => {
  "use server";
  await requireUser();
  return listSuppliers(db);
}, "suppliers");

const canManageQuery = query(async () => {
  "use server";
  const me = await currentUser();
  return !!me && me.role !== "user";
}, "suppliersCanManage");

const addSupplier = action(async (form: FormData) => {
  "use server";
  await requireAdmin();
  const name = String(form.get("name") ?? "");
  return runMutation({ audit: ["create", "supplier"] }, () => {
    createSupplier(db, name);
  });
}, "addSupplier");

const editSupplier = action(async (form: FormData) => {
  "use server";
  await requireAdmin();
  const id = Number(form.get("id"));
  const name = String(form.get("name") ?? "");
  return runMutation({ audit: ["update", "supplier"] }, () => {
    renameSupplier(db, id, name);
  });
}, "editSupplier");

const removeSupplier = action(async (form: FormData) => {
  "use server";
  await requireAdmin();
  const id = Number(form.get("id"));
  return runMutation({ audit: ["delete", "supplier"] }, () => {
    deleteSupplier(db, id);
  });
}, "removeSupplier");

const bulkRemoveSuppliers = action(async (form: FormData) => {
  "use server";
  await requireAdmin();
  const ids = form.getAll("id").map(Number);
  return runMutation({ audit: ["delete", "supplier"] }, () => {
    deleteSuppliers(db, ids);
  });
}, "bulkRemoveSuppliers");

export const route = { preload: () => listSuppliersQuery() };

// Dismiss the native popover a menu button lives in — top-layer menus don't close on inner clicks.
function closePopover(el: HTMLElement) {
  el.closest<HTMLElement>("[popover]")?.hidePopover();
}

export default function Suppliers() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const suppliers = createAsync(() => listSuppliersQuery(), { initialValue: [] });
  const canManage = createAsync(() => canManageQuery(), { initialValue: false });
  const adding = useSubmission(addSupplier);
  const editing = useSubmission(editSupplier);
  const removing = useSubmission(removeSupplier);
  const bulkRemoving = useSubmission(bulkRemoveSuppliers);
  const errMsg = (code: string) => t(`suppliers.err_${code}` as Parameters<typeof t>[0]) as string;
  const form = createEntityForm(adding);
  // The supplier whose edit modal is open (null = closed); holds the row so the form pre-fills.
  const [editTarget, setEditTarget] = createSignal<Supplier | null>(null);
  // Close the edit modal once its save lands.
  createEffect(() => {
    if (editing.result?.ok) setEditTarget(null);
  });

  // Filter + sort are client-side: the whole list is already loaded and tiny (EX-5), so a round-trip
  // would only add latency. Bulk selection is held as a Set of ids.
  const [q, setQ] = createSignal("");
  const [sortDir, setSortDir] = createSignal<"asc" | "desc">("asc");
  const [selected, setSelected] = createSignal<Set<number>>(new Set());

  const view = createMemo(() => {
    const needle = q().trim().toLowerCase();
    const rows = suppliers().filter((s) => s.name.toLowerCase().includes(needle));
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
  const allVisibleSelected = () => view().length > 0 && view().every((s) => selected().has(s.id));
  const toggleAll = () =>
    setSelected(allVisibleSelected() ? new Set<number>() : new Set(view().map((s) => s.id)));

  // Clear the selection once a bulk delete lands so the (now-gone) ids don't linger.
  createEffect(() => {
    if (bulkRemoving.result?.ok) setSelected(new Set<number>());
  });

  const cols = () => (canManage() ? 3 : 1);

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("suppliers.title")}</h1>
        </div>
        <Show when={canManage()}>
          <div class="page-head-actions">
            <button type="button" onClick={form.openForm}>
              + {t("suppliers.add")}
            </button>
          </div>
        </Show>
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

      {/* Edit modal — pre-filled with the row's current name; mirrors the expenses edit flow. */}
      <Modal
        open={editTarget() != null}
        onClose={() => setEditTarget(null)}
        title={t("suppliers.editTitle")}
      >
        <Show when={editTarget()}>
          {(s) => (
            <form action={editSupplier} method="post" class="toolbar entry-form">
              <input type="hidden" name="id" value={s().id} />
              <label class="tb-field tb-grow">
                <span>{t("suppliers.name")}</span>
                <input name="name" value={s().name} required />
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

      <Show when={removing.result?.error ?? bulkRemoving.result?.error}>
        {(err) => (
          <p class="alert alert-error" role="alert">
            {errMsg(err())}
          </p>
        )}
      </Show>
      <Show when={editing.result?.ok || removing.result?.ok || bulkRemoving.result?.ok}>
        <p class="alert alert-success" role="status">
          {t("common.saved")}
        </p>
      </Show>

      <div class="toolbar filter">
        <input
          type="search"
          placeholder={t("suppliers.filter")}
          value={q()}
          onInput={(e) => setQ(e.currentTarget.value)}
          aria-label={t("suppliers.filter")}
        />
        {/* Bulk action bar appears only with a live selection — no dead buttons otherwise. */}
        <Show when={canManage() && selected().size > 0}>
          <span class="toolbar-label">
            {selected().size} {t("suppliers.selected")}
          </span>
          <form action={bulkRemoveSuppliers} method="post">
            <For each={[...selected()]}>{(id) => <input type="hidden" name="id" value={id} />}</For>
            <button
              type="submit"
              class="btn-ghost"
              disabled={bulkRemoving.pending}
              onClick={async (e) => {
                e.preventDefault();
                const f = e.currentTarget.form;
                if (
                  await confirm({ message: t("suppliers.confirmDeleteSelected"), danger: true })
                ) {
                  f?.requestSubmit();
                }
              }}
            >
              {t("suppliers.deleteSelected")}
            </button>
          </form>
        </Show>
      </div>

      <div class="panel table-scroll">
        <table>
          <thead>
            <tr>
              <Show when={canManage()}>
                <th class="col-check">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected()}
                    onChange={toggleAll}
                    aria-label={t("common.actions")}
                  />
                </th>
              </Show>
              <th>
                <button
                  type="button"
                  class="th-sort"
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                >
                  {t("suppliers.name")}{" "}
                  <span aria-hidden="true">{sortDir() === "asc" ? "▲" : "▼"}</span>
                </button>
              </th>
              <Show when={canManage()}>
                <th class="col-actions">
                  <span class="sr-only">{t("common.actions")}</span>
                </th>
              </Show>
            </tr>
          </thead>
          <tbody>
            <For
              each={view()}
              fallback={
                <tr>
                  <td class="note" colspan={cols()}>
                    {suppliers().length === 0 ? t("suppliers.empty") : t("suppliers.noMatch")}
                  </td>
                </tr>
              }
            >
              {(s) => (
                <tr>
                  <Show when={canManage()}>
                    <td class="col-check">
                      <input
                        type="checkbox"
                        checked={selected().has(s.id)}
                        onChange={() => toggle(s.id)}
                        aria-label={s.name}
                      />
                    </td>
                  </Show>
                  <td>{s.name}</td>
                  <Show when={canManage()}>
                    {/* Row action menu (⋯): edit + delete. Native Popover API → top layer, so
                        the dropdown is never clipped by the table; anchor ties it to this row. */}
                    <td class="col-actions" data-label={t("common.actions")}>
                      <button
                        type="button"
                        class="row-menu-trigger"
                        aria-label={t("common.actions")}
                        popovertarget={`sup-menu-${s.id}`}
                        style={{ "anchor-name": `--sup-menu-${s.id}` }}
                      >
                        ⋯
                      </button>
                      <div
                        id={`sup-menu-${s.id}`}
                        popover="auto"
                        class="menu-pop"
                        style={{ "position-anchor": `--sup-menu-${s.id}` }}
                      >
                        <button
                          type="button"
                          class="menu-item"
                          onClick={(ev) => {
                            editing.clear?.(); // fresh modal — no stale error banner
                            setEditTarget(s);
                            closePopover(ev.currentTarget);
                          }}
                        >
                          {t("common.edit")}
                        </button>
                        <form action={removeSupplier} method="post">
                          <input type="hidden" name="id" value={s.id} />
                          <button
                            type="submit"
                            class="menu-item"
                            onClick={async (ev) => {
                              ev.preventDefault();
                              const button = ev.currentTarget;
                              const f = button.form;
                              if (
                                await confirm({
                                  message: t("suppliers.confirmDelete"),
                                  danger: true,
                                })
                              ) {
                                closePopover(button);
                                f?.requestSubmit();
                              }
                            }}
                          >
                            {t("suppliers.delete")}
                          </button>
                        </form>
                      </div>
                    </td>
                  </Show>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
