import { action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { db } from "~/db/index";
import { getSettings, parseSettings, updateSettings } from "~/db/settings";
import { useI18n } from "~/lib/i18n";
import { can } from "~/lib/permissions";
import { currentUser, recordAudit } from "~/lib/session";

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
  const parsed = parseSettings(form);
  if ("error" in parsed) return { error: parsed.error };
  updateSettings(db, parsed.patch);
  await recordAudit("update", "settings");
  return { ok: true };
}, "saveSettings");

export default function Settings() {
  const { t } = useI18n();
  const s = createAsync(() => settingsQuery());
  const saving = useSubmission(saveSettings);

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
        </div>
      </header>
      <Show when={s()}>
        {(cfg) => (
          <form action={saveSettings} method="post" class="panel panel-pad">
            <label class="field">
              <span>{t("settings.commission")}</span>
              <input
                type="number"
                name="commissionPct"
                step="0.1"
                min="0"
                max="100"
                value={(cfg().commissionRate * 100).toString()}
              />
            </label>
            <label class="field">
              <span>{t("settings.fxSource")}</span>
              <input name="fxSource" value={cfg().fxSource} />
            </label>
            <label class="field">
              <span>{t("settings.locale")}</span>
              <select name="defaultLocale">
                <option value="es" selected={cfg().defaultLocale === "es"}>
                  ES
                </option>
                <option value="en" selected={cfg().defaultLocale === "en"}>
                  EN
                </option>
              </select>
            </label>
            <label class="field">
              <span>{t("settings.backup")}</span>
              <input name="backupCadence" value={cfg().backupCadence} />
            </label>
            <div
              style={{
                display: "flex",
                gap: "12px",
                "align-items": "center",
                "margin-top": "16px",
              }}
            >
              <button type="submit" disabled={saving.pending}>
                {saving.pending ? t("common.saving") : t("common.save")}
              </button>
              <Show when={saving.result?.ok}>
                <span class="saved">{t("settings.saved")}</span>
              </Show>
            </div>
            <Show when={saving.result?.error}>
              <p class="alert alert-error" role="alert" style={{ "margin-top": "12px" }}>
                {t("settings.commissionInvalid")}
              </p>
            </Show>
          </form>
        )}
      </Show>
    </AppShell>
  );
}
