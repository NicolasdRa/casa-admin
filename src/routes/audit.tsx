import { createAsync, query, redirect } from "@solidjs/router";
import { For } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { listAuditLog } from "~/db/audit";
import { db } from "~/db/index";
import { listUsers } from "~/db/users";
import { useI18n } from "~/lib/i18n";
import { currentUser } from "~/lib/session";

const auditQuery = query(async () => {
  "use server";
  const me = await currentUser();
  if (!me || me.role === "user") throw redirect("/"); // admin/superadmin only
  const names = new Map(listUsers(db).map((u) => [u.id, u.name]));
  return listAuditLog(db, 200).map((e) => ({
    id: e.id,
    when: e.timestamp,
    who: e.userId ? (names.get(e.userId) ?? `#${e.userId}`) : "—",
    action: e.action,
    entity: e.entity,
  }));
}, "auditLog");

export default function Audit() {
  const { t } = useI18n();
  const log = createAsync(() => auditQuery(), { initialValue: [] });

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("audit.title")}</h1>
        </div>
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
              each={log()}
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
                    <span class="chip chip-pending">{e.action}</span>
                  </td>
                  <td class="mono">{e.entity}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
