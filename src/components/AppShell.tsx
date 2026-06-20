import { A, action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { type JSX, Show } from "solid-js";
import { useI18n } from "~/lib/i18n";
import { can } from "~/lib/permissions";
import { clearSession, currentUser } from "~/lib/session";

const currentUserQuery = query(async () => {
  "use server";
  return currentUser();
}, "currentUser");

const logoutAction = action(async () => {
  "use server";
  await clearSession();
  throw redirect("/login");
}, "logout");

/**
 * App chrome: navy sidebar (nav + identity), content column on the right.
 * Routes render their page inside `<AppShell>`; the sidebar collapses to a top
 * bar under 880px (no JS drawer — a horizontal nav keeps every link reachable).
 */
export function AppShell(props: { children: JSX.Element }) {
  const { t, locale, setLocale } = useI18n();
  const user = createAsync(() => currentUserQuery());
  const loggingOut = useSubmission(logoutAction);

  return (
    <div class="app-shell">
      <aside class="app-sidebar">
        <div class="app-brand">
          <strong>{t("app.title")}</strong>
          <span>{t("app.subtitle")}</span>
        </div>
        <nav class="app-nav">
          <A href="/" end activeClass="is-active">
            {t("nav.dashboard")}
          </A>
          <A href="/bookings" activeClass="is-active">
            {t("nav.bookings")}
          </A>
          <A href="/expenses" activeClass="is-active">
            {t("nav.expenses")}
          </A>
          <A href="/maintenance" activeClass="is-active">
            {t("nav.tasks")}
          </A>
          <A href="/reports" activeClass="is-active">
            {t("nav.reports")}
          </A>
          <Show when={user() && can(user()!.role, "managePartnersCash")}>
            <A href="/caja" activeClass="is-active">
              {t("caja.manage")}
            </A>
          </Show>
          <Show when={user() && can(user()!.role, "manageUsers")}>
            <A href="/users" activeClass="is-active">
              {t("users.manage")}
            </A>
          </Show>
          <Show when={user() && can(user()!.role, "manageSettings")}>
            <A href="/settings" activeClass="is-active">
              {t("settings.manage")}
            </A>
          </Show>
          {/* Audit log is admin/superadmin only — matches the route's own guard (role !== "user"). */}
          <Show when={user() && user()!.role !== "user"}>
            <A href="/audit" activeClass="is-active">
              {t("audit.title")}
            </A>
          </Show>
        </nav>
        <div class="app-foot">
          <Show when={user()}>
            {(u) => (
              <div class="who">
                <b>{u().name}</b>
                <span>{t(`users.role_${u().role}`)}</span>
              </div>
            )}
          </Show>
          <div class="app-foot-actions">
            <button
              type="button"
              class="btn-ghost"
              onClick={() => setLocale(locale() === "es" ? "en" : "es")}
            >
              {locale() === "es" ? "EN" : "ES"}
            </button>
            <Show when={user()}>
              <A href="/security" class="btn-ghost">
                {t("security.title")}
              </A>
              <form action={logoutAction} method="post" style={{ flex: 1, display: "flex" }}>
                <button type="submit" disabled={loggingOut.pending} style={{ flex: 1 }}>
                  {t("auth.logout")}
                </button>
              </form>
            </Show>
          </div>
        </div>
      </aside>
      <main class="app-main">
        <div class="app-content">{props.children}</div>
      </main>
    </div>
  );
}
