import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { Show } from "solid-js";
import { db } from "~/db/index";
import { getSettings, type SettingsPatch, updateSettings } from "~/db/settings";
import { useI18n } from "~/lib/i18n";
import { can } from "~/lib/permissions";
import { currentUser } from "~/lib/session";

async function requireManageSettings() {
  const me = await currentUser();
  if (!me || !can(me.role, "manageSettings")) throw redirect("/");
  return me;
}

const settingsQuery = query(async () => {
  "use server";
  await requireManageSettings();
  return getSettings(db);
}, "settings");

const saveSettings = action(async (form: FormData) => {
  "use server";
  await requireManageSettings();
  const patch: SettingsPatch = {};
  const pct = Number(form.get("commissionPct"));
  if (Number.isFinite(pct) && pct >= 0 && pct <= 100) patch.commissionRate = pct / 100;
  const locale = form.get("defaultLocale");
  if (locale === "es" || locale === "en") patch.defaultLocale = locale;
  const fxSource = String(form.get("fxSource") ?? "").trim();
  if (fxSource) patch.fxSource = fxSource;
  const backup = String(form.get("backupCadence") ?? "").trim();
  if (backup) patch.backupCadence = backup;
  updateSettings(db, patch);
  return { ok: true };
}, "saveSettings");

export default function Settings() {
  const { t } = useI18n();
  const s = createAsync(() => settingsQuery());
  const saving = useSubmission(saveSettings);
  const row = {
    display: "flex",
    gap: "0.5rem",
    "align-items": "center",
    margin: "0.5rem 0",
  } as const;

  return (
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "32rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>{t("settings.title")}</h1>
      <Show when={s()}>
        {(cfg) => (
          <form action={saveSettings} method="post">
            <label style={row}>
              <span style={{ width: "12rem" }}>{t("settings.commission")}</span>
              <input
                type="number"
                name="commissionPct"
                step="0.1"
                min="0"
                max="100"
                value={(cfg().commissionRate * 100).toString()}
              />
            </label>
            <label style={row}>
              <span style={{ width: "12rem" }}>{t("settings.fxSource")}</span>
              <input name="fxSource" value={cfg().fxSource} />
            </label>
            <label style={row}>
              <span style={{ width: "12rem" }}>{t("settings.locale")}</span>
              <select name="defaultLocale">
                <option value="es" selected={cfg().defaultLocale === "es"}>
                  ES
                </option>
                <option value="en" selected={cfg().defaultLocale === "en"}>
                  EN
                </option>
              </select>
            </label>
            <label style={row}>
              <span style={{ width: "12rem" }}>{t("settings.backup")}</span>
              <input name="backupCadence" value={cfg().backupCadence} />
            </label>
            <button type="submit">{t("common.save")}</button>
            <Show when={saving.result?.ok}>
              <span style={{ color: "green", "margin-left": "0.5rem" }}>{t("settings.saved")}</span>
            </Show>
          </form>
        )}
      </Show>
    </main>
  );
}
