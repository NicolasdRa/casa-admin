import { A, action, createAsync, query, redirect, useSubmission } from "@solidjs/router";
import { For, Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { db } from "~/db/index";
import {
  BACKUP_CADENCES,
  FX_SOURCES,
  getSettings,
  parseSettings,
  updateSettings,
} from "~/db/settings";
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
              <select name="fxSource">
                <For each={FX_SOURCES}>
                  {(src) => (
                    <option value={src} selected={cfg().fxSource === src}>
                      {src}
                    </option>
                  )}
                </For>
              </select>
              <A href="/fx" class="note">
                {t("fx.viewHistory")} ›
              </A>
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
            <div class="field" style={{ display: "block" }}>
              <strong>{t("settings.icalSync")}</strong>
              <p class="note" style={{ margin: "4px 0 0" }}>
                {t("settings.icalHint")}
              </p>
            </div>
            <label class="field">
              <span>{t("settings.airbnbIcal")}</span>
              <input
                type="url"
                name="airbnbIcalUrl"
                inputmode="url"
                placeholder="https://www.airbnb.com/calendar/ical/…"
                value={cfg().airbnbIcalUrl ?? ""}
                style={{ "max-width": "28rem" }}
              />
            </label>
            <label class="field">
              <span>{t("settings.bookingIcal")}</span>
              <input
                type="url"
                name="bookingIcalUrl"
                inputmode="url"
                placeholder="https://ical.booking.com/…"
                value={cfg().bookingIcalUrl ?? ""}
                style={{ "max-width": "28rem" }}
              />
            </label>
            <label class="field">
              <span>{t("settings.bookingGap")}</span>
              <input
                type="number"
                name="bookingGapDays"
                min="0"
                step="1"
                value={cfg().bookingGapDays.toString()}
              />
              <span class="note">{t("settings.bookingGapHint")}</span>
            </label>
            <label class="field">
              <span>{t("settings.backup")}</span>
              <select name="backupCadence">
                <For each={BACKUP_CADENCES}>
                  {(c) => (
                    <option value={c} selected={cfg().backupCadence === c}>
                      {t(`settings.backup_${c}` as Parameters<typeof t>[0]) as string}
                    </option>
                  )}
                </For>
              </select>
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
                {saving.result?.error === "icalUrlInvalid"
                  ? t("settings.icalUrlInvalid")
                  : saving.result?.error === "gapInvalid"
                    ? t("settings.gapInvalid")
                    : t("settings.commissionInvalid")}
              </p>
            </Show>
          </form>
        )}
      </Show>
    </AppShell>
  );
}
