import { useI18n } from "~/lib/i18n";

export default function Dashboard() {
  const { t, locale, setLocale } = useI18n();
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
        <button type="button" onClick={() => setLocale(locale() === "es" ? "en" : "es")}>
          {locale() === "es" ? "EN" : "ES"}
        </button>
      </header>
      <nav style={{ display: "flex", gap: "1rem", "margin-top": "1rem" }}>
        <span>{t("nav.dashboard")}</span>
        <span>{t("nav.bookings")}</span>
        <span>{t("nav.expenses")}</span>
        <span>{t("nav.tasks")}</span>
        <span>{t("nav.reports")}</span>
      </nav>
      <p style={{ "margin-top": "2rem", color: "#999" }}>
        Foundation scaffold — schema, FX core and i18n are wired. Modules come next.
      </p>
    </main>
  );
}
