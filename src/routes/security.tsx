import { action, createAsync, query, useSubmission } from "@solidjs/router";
import { Show } from "solid-js";
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
    <main
      style={{
        "font-family": "system-ui, sans-serif",
        "max-width": "40rem",
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>{t("security.title")}</h1>
      <p>
        {t("security.status")}:{" "}
        <b>{status().enabled ? t("security.enabled") : t("security.disabled")}</b>
      </p>

      <Show when={!status().enabled && !enabling.result?.ok}>
        <form action={generateSecret} method="post">
          <button type="submit">{t("security.generate")}</button>
        </form>
        <Show when={gen.result?.secret}>
          <div style={{ margin: "1rem 0" }}>
            <p>
              {t("security.secret")}: <code>{gen.result?.secret}</code>
            </p>
            <p style={{ "font-size": "0.8rem", color: "#777", "word-break": "break-all" }}>
              {gen.result?.uri}
            </p>
            <form action={enable2fa} method="post" style={{ display: "flex", gap: "0.5rem" }}>
              <input type="hidden" name="secret" value={gen.result?.secret} />
              <input name="code" inputmode="numeric" placeholder={t("auth.totp")} required />
              <button type="submit">{t("security.enable")}</button>
            </form>
          </div>
        </Show>
      </Show>

      <Show when={status().enabled}>
        <form
          action={disable2fa}
          method="post"
          style={{ display: "flex", gap: "0.5rem", margin: "1rem 0" }}
        >
          <input name="code" inputmode="numeric" placeholder={t("auth.totp")} required />
          <button type="submit">{t("security.disable")}</button>
        </form>
      </Show>

      <Show when={enabling.result?.ok}>
        <p style={{ color: "green" }}>{t("security.done")}</p>
      </Show>
      <Show when={enabling.result?.error || disabling.result?.error}>
        <p style={{ color: "crimson" }}>{t("security.codeError")}</p>
      </Show>
    </main>
  );
}
