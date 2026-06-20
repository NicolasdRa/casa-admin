import { A, action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { Show } from "solid-js";
import { useI18n } from "~/lib/i18n";
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

export default function Dashboard() {
  const { t, locale, setLocale } = useI18n();
  const user = createAsync(() => currentUserQuery());
  const loggingOut = useSubmission(logoutAction);

  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "60rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <header
        style={{ display: "flex", "justify-content": "space-between", "align-items": "baseline" }}
      >
        <div>
          <h1 style={{ margin: 0 }}>{t("app.title")}</h1>
          <p style={{ color: "#666", margin: "0.25rem 0" }}>{t("app.subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", "align-items": "center" }}>
          <Show when={user()}>
            {(u) => (
              <span style={{ color: "#555" }}>
                {u().name} ({u().role})
              </span>
            )}
          </Show>
          <button type="button" onClick={() => setLocale(locale() === "es" ? "en" : "es")}>
            {locale() === "es" ? "EN" : "ES"}
          </button>
          <Show when={user()}>
            <form action={logoutAction} method="post">
              <button type="submit" disabled={loggingOut.pending}>
                {t("auth.logout")}
              </button>
            </form>
          </Show>
        </div>
      </header>
      <nav style={{ display: "flex", gap: "1rem", "margin-top": "1rem" }}>
        <span>{t("nav.dashboard")}</span>
        <A href="/bookings">{t("nav.bookings")}</A>
        <A href="/expenses">{t("nav.expenses")}</A>
        <span>{t("nav.tasks")}</span>
        <span>{t("nav.reports")}</span>
      </nav>
      <p style={{ "margin-top": "2rem", color: "#999" }}>
        Foundation scaffold — schema, FX core and i18n are wired. Modules come next.
      </p>
    </main>
  );
}
