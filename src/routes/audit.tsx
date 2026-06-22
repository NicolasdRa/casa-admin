import { createAsync, query, redirect, useSearchParams } from "@solidjs/router";
import { For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { listAuditLog } from "~/db/audit";
import { db } from "~/db/index";
import { listUsers } from "~/db/users";
import { useI18n } from "~/lib/i18n";
import { currentUser } from "~/lib/session";

const PAGE = 100;
const ACTIONS = ["create", "update", "delete"];

const auditQuery = query(async (action: string, entity: string, page: number) => {
  "use server";
  const me = await currentUser();
  if (!me || me.role === "user") throw redirect("/"); // admin/superadmin only
  const names = new Map(listUsers(db).map((u) => [u.id, u.name]));
  // Fetch one extra row to know if a next page exists — no separate count query.
  const rows = listAuditLog(db, { action, entity, limit: PAGE + 1, offset: page * PAGE });
  return {
    hasMore: rows.length > PAGE,
    rows: rows.slice(0, PAGE).map((e) => ({
      id: e.id,
      when: e.timestamp,
      who: e.userId ? (names.get(e.userId) ?? `#${e.userId}`) : "—",
      action: e.action,
      entity: e.entity,
    })),
  };
}, "auditLog");

// Color the action by what it did, not "pending" for all: created (added) reads
// green, deleted (removed) reads rose, everything else stays a neutral label.
const actionChip = (action: string) =>
  action === "create"
    ? "chip chip-pos"
    : action === "delete"
      ? "chip chip-neg"
      : "chip chip-neutral";

export default function Audit() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const action = () => (typeof params.action === "string" ? params.action : "");
  const entity = () => (typeof params.entity === "string" ? params.entity : "");
  const page = () => Math.max(0, Number(params.page) || 0);
  const data = createAsync(() => auditQuery(action(), entity(), page()), {
    initialValue: { hasMore: false, rows: [] },
  });
  // Preserve filters when paging; reset page to 0 on a new filter (the form omits page).
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (action()) q.set("action", action());
    if (entity()) q.set("entity", entity());
    if (p > 0) q.set("page", String(p));
    const s = q.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("audit.title")}</h1>
        </div>
        <form method="get" class="page-head-actions">
          <select name="action" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
            <option value="">{t("audit.allActions")}</option>
            <For each={ACTIONS}>
              {(a) => (
                <option value={a} selected={a === action()}>
                  {a}
                </option>
              )}
            </For>
          </select>
          <input
            type="search"
            name="entity"
            value={entity()}
            placeholder={t("audit.searchEntity")}
            aria-label={t("audit.entity")}
          />
        </form>
      </header>
      <div class="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("audit.when")}</th>
              <th>{t("audit.user")}</th>
              <th>{t("audit.action")}</th>
              <th>{t("audit.entity")}</th>
            </tr>
          </thead>
          <tbody>
            <For
              each={data().rows}
              fallback={
                <tr>
                  <td colspan="4" class="note">
                    {t("audit.empty")}
                  </td>
                </tr>
              }
            >
              {(e) => (
                <tr>
                  <td class="mono">{e.when}</td>
                  <td>{e.who}</td>
                  <td>
                    <span class={actionChip(e.action)}>{e.action}</span>
                  </td>
                  <td class="mono">{e.entity}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={page() > 0 || data().hasMore}>
        <nav class="page-head-actions" style={{ "justify-content": "flex-end" }}>
          <Show when={page() > 0}>
            <a class="btn-ghost" href={pageHref(page() - 1)}>
              ← {t("audit.prev")}
            </a>
          </Show>
          <Show when={data().hasMore}>
            <a class="btn-ghost" href={pageHref(page() + 1)}>
              {t("audit.next")} →
            </a>
          </Show>
        </nav>
      </Show>
    </AppShell>
  );
}
