import { createAsync, query, redirect } from "@solidjs/router";
import { For } from "solid-js";
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
  const cell = { padding: "0.4rem 0.6rem", "border-bottom": "1px solid #eee" } as const;

  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "55rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>{t("audit.title")}</h1>
      <table style={{ "border-collapse": "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{t("audit.when")}</th>
            <th style={cell}>{t("audit.user")}</th>
            <th style={cell}>{t("audit.action")}</th>
            <th style={cell}>{t("audit.entity")}</th>
          </tr>
        </thead>
        <tbody>
          <For
            each={log()}
            fallback={
              <tr>
                <td colspan="4" style={cell}>
                  {t("audit.empty")}
                </td>
              </tr>
            }
          >
            {(e) => (
              <tr>
                <td style={cell}>{e.when}</td>
                <td style={cell}>{e.who}</td>
                <td style={cell}>{e.action}</td>
                <td style={cell}>{e.entity}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </main>
  );
}
