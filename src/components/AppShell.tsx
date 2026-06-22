import { A, action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { For, type JSX, Show } from "solid-js";
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

// Inline stroke icons (no icon dep) for the mobile bottom tab bar.
function Icon(props: { name: "home" | "cal" | "receipt" | "chart" | "more" }) {
  return (
    <svg
      class="tab-ico"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <Show when={props.name === "home"}>
        <path d="M3 10.8 12 3l9 7.8" />
        <path d="M5 9.6V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.6" />
      </Show>
      <Show when={props.name === "cal"}>
        <rect x="3" y="4.5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 2.5v4M16 2.5v4" />
      </Show>
      <Show when={props.name === "receipt"}>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 12h.01M18 12h.01" />
      </Show>
      <Show when={props.name === "chart"}>
        <path d="M4 21V10M10 21V4M16 21v-7M21 21H3" />
      </Show>
      <Show when={props.name === "more"}>
        <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
      </Show>
    </svg>
  );
}

/**
 * App chrome. Desktop (≥880px): navy sidebar with full nav + identity.
 * Mobile (<880px): a name-only top bar, a fixed 5-item icon tab bar, and a
 * bottom-sheet (<dialog>) holding the full navigation + account actions.
 */
export function AppShell(props: { children: JSX.Element }) {
  const { t, locale, setLocale } = useI18n();
  const user = createAsync(() => currentUserQuery());
  const loggingOut = useSubmission(logoutAction);

  // Single source of truth for the gated nav — drives both the sidebar and the sheet.
  const navItems = () => {
    const me = user();
    const items: { href: string; label: string; end?: boolean }[] = [
      { href: "/", label: t("nav.dashboard"), end: true },
      { href: "/bookings", label: t("nav.bookings") },
      { href: "/expenses", label: t("nav.expenses") },
      { href: "/suppliers", label: t("suppliers.manage") },
      { href: "/maintenance", label: t("nav.tasks") },
      { href: "/reports", label: t("nav.reports") },
    ];
    if (me && can(me.role, "managePartnersCash"))
      items.push({ href: "/caja", label: t("caja.manage") });
    if (me && can(me.role, "manageUsers")) items.push({ href: "/users", label: t("users.manage") });
    if (me && can(me.role, "manageSettings"))
      items.push({ href: "/settings", label: t("settings.manage") });
    if (me && me.role !== "user") items.push({ href: "/audit", label: t("audit.title") });
    return items;
  };

  let sheet!: HTMLDialogElement;
  const openSheet = () => sheet.showModal();
  const closeSheet = () => sheet.close();

  return (
    <div class="app-shell">
      {/* Desktop sidebar */}
      <aside class="app-sidebar">
        <div class="app-brand">
          <strong>{t("app.title")}</strong>
          <span>{t("app.subtitle")}</span>
        </div>
        <nav class="app-nav">
          <For each={navItems()}>
            {(n) => (
              <A href={n.href} end={n.end} activeClass="is-active">
                {n.label}
              </A>
            )}
          </For>
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
              <form action={logoutAction} method="post" style={{ flex: 1, display: "flex" }}>
                <button type="submit" disabled={loggingOut.pending} style={{ flex: 1 }}>
                  {t("auth.logout")}
                </button>
              </form>
            </Show>
          </div>
        </div>
      </aside>

      {/* Mobile top bar — name only */}
      <header class="app-topbar">
        <strong>{t("app.title")}</strong>
      </header>

      <main class="app-main">
        <div class="app-content">{props.children}</div>
      </main>

      {/* Mobile bottom tab bar — 4 primary destinations + More */}
      <nav class="app-tabbar" aria-label={t("app.title")}>
        <A href="/" end activeClass="is-active" class="tab">
          <Icon name="home" />
          <span>{t("nav.dashboard")}</span>
        </A>
        <A href="/bookings" activeClass="is-active" class="tab">
          <Icon name="cal" />
          <span>{t("nav.bookings")}</span>
        </A>
        <A href="/expenses" activeClass="is-active" class="tab">
          <Icon name="receipt" />
          <span>{t("nav.expenses")}</span>
        </A>
        <A href="/reports" activeClass="is-active" class="tab">
          <Icon name="chart" />
          <span>{t("nav.reports")}</span>
        </A>
        <button type="button" class="tab" onClick={openSheet}>
          <Icon name="more" />
          <span>{t("nav.more")}</span>
        </button>
      </nav>

      {/* Full navigation + account actions, as a bottom sheet */}
      <dialog
        class="app-sheet"
        ref={sheet}
        onClick={(e) => {
          if (e.target === sheet) closeSheet(); // click on the backdrop dismisses
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") closeSheet();
        }}
      >
        <div class="sheet-body">
          <div class="sheet-grip" />
          <Show when={user()}>
            {(u) => (
              <div class="sheet-who">
                <b>{u().name}</b>
                <span>{t(`users.role_${u().role}`)}</span>
              </div>
            )}
          </Show>
          <nav class="sheet-nav">
            <For each={navItems()}>
              {(n) => (
                <A href={n.href} end={n.end} activeClass="is-active" onClick={closeSheet}>
                  {n.label}
                </A>
              )}
            </For>
          </nav>
          <div class="sheet-account">
            <button
              type="button"
              class="btn-ghost"
              onClick={() => setLocale(locale() === "es" ? "en" : "es")}
            >
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
        </div>
      </dialog>
    </div>
  );
}
