import { action, createAsync, query, useSubmission } from "@solidjs/router";
import { Show } from "solid-js";
import { AppShell } from "~/components/AppShell";
import { db } from "~/db/index";
import { setTotpSecret } from "~/db/users";
import { useI18n } from "~/lib/i18n";
import { recordAudit, requireUser } from "~/lib/session";
import { otpauthUri, randomBase32Secret, verifyTotp } from "~/lib/totp";

const statusQuery = query(async () => {
  "use server";
  const me = await requireUser();
  return { enabled: !!me.totpSecret };
}, "twoFactorStatus");

// Step 1: mint a candidate secret to display (not stored until confirmed with a valid code).
const generateSecret = action(async () => {
  "use server";
  const me = await requireUser();
  const secret = randomBase32Secret();
  return { secret, uri: otpauthUri(secret, me.email) };
}, "generate2fa");

// Step 2: confirm the candidate secret with a code, then persist it.
const enable2fa = action(async (form: FormData) => {
  "use server";
  const me = await requireUser();
  const secret = String(form.get("secret") ?? "");
  const code = String(form.get("code") ?? "").trim();
  if (!secret || !verifyTotp(secret, code, Date.now())) return { error: true };
  setTotpSecret(db, me.id, secret);
  await recordAudit("update", `user:${me.id}:2fa-enabled`);
  return { ok: true };
}, "enable2fa");

const disable2fa = action(async (form: FormData) => {
  "use server";
  const me = await requireUser();
  const code = String(form.get("code") ?? "").trim();
  // Require a valid current code to turn it off.
  if (!me.totpSecret || !verifyTotp(me.totpSecret, code, Date.now())) return { error: true };
  setTotpSecret(db, me.id, null);
  await recordAudit("update", `user:${me.id}:2fa-disabled`);
  return { ok: true };
}, "disable2fa");

export default function Security() {
  const { t } = useI18n();
  const status = createAsync(() => statusQuery(), { initialValue: { enabled: false } });
  const gen = useSubmission(generateSecret);
  const enabling = useSubmission(enable2fa);
  const disabling = useSubmission(disable2fa);

  return (
    <AppShell>
      <header class="page-head">
        <div>
          <h1>{t("security.title")}</h1>
          <p class="sub">
            {t("security.status")}:{" "}
            <span class={status().enabled ? "chip chip-pos" : "chip chip-pending"}>
              {status().enabled ? t("security.enabled") : t("security.disabled")}
            </span>
          </p>
        </div>
      </header>

      <Show when={!status().enabled && !enabling.result?.ok}>
        <section
          class="panel panel-pad"
          style={{ display: "flex", "flex-direction": "column", gap: "16px" }}
        >
          <form action={generateSecret} method="post">
            <button type="submit">{t("security.generate")}</button>
          </form>
          <Show when={gen.result?.secret}>
            <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
              <p>
                {t("security.secret")}: <span class="mono">{gen.result?.secret}</span>
              </p>
              <p class="mono" style={{ "word-break": "break-all" }}>
                {gen.result?.uri}
              </p>
              <form action={enable2fa} method="post" class="toolbar">
                <input type="hidden" name="secret" value={gen.result?.secret} />
                <input name="code" inputmode="numeric" placeholder={t("auth.totp")} required />
                <button type="submit">{t("security.enable")}</button>
              </form>
            </div>
          </Show>
        </section>
      </Show>

      <Show when={status().enabled}>
        <section class="panel panel-pad">
          <form action={disable2fa} method="post" class="toolbar">
            <input name="code" inputmode="numeric" placeholder={t("auth.totp")} required />
            <button type="submit">{t("security.disable")}</button>
          </form>
        </section>
      </Show>

      <Show when={enabling.result?.ok}>
        <p class="alert" style={{ color: "var(--pos)", background: "var(--pos-bg)" }}>
          {t("security.done")}
        </p>
      </Show>
      <Show when={enabling.result?.error || disabling.result?.error}>
        <p class="alert alert-error">{t("security.codeError")}</p>
      </Show>
    </AppShell>
  );
}
