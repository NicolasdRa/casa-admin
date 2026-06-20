import { action, redirect, useSubmission } from "@solidjs/router";
import { Show } from "solid-js";
import { db } from "~/db/index";
import { getUserByEmail } from "~/db/users";
import { useI18n } from "~/lib/i18n";
import { verifyPassword } from "~/lib/password";
import { setSessionUser } from "~/lib/session";

const loginAction = action(async (form: FormData) => {
  "use server";
  const email = String(form.get("email") ?? "");
  const pwd = String(form.get("password") ?? "");
  const user = getUserByEmail(db, email);
  // Identical error whether the email is unknown or the password is wrong (no field-level hint).
  if (!user) return { error: true };
  if (user.status !== "active" || !verifyPassword(pwd, user.passwordHash)) return { error: true };
  await setSessionUser(user.id);
  throw redirect("/");
}, "login");

export default function Login() {
  const { t } = useI18n();
  const submission = useSubmission(loginAction);

  return (
    <main class="auth">
      <div class="auth-card">
        <div class="auth-brand">
          <h1>{t("app.title")}</h1>
          <span>{t("app.subtitle")}</span>
        </div>
        <form action={loginAction} method="post">
          <input
            type="email"
            name="email"
            placeholder={t("auth.email")}
            required
            autocomplete="username"
          />
          <input
            type="password"
            name="password"
            placeholder={t("auth.password")}
            required
            autocomplete="current-password"
          />
          <button type="submit" disabled={submission.pending}>
            {t("auth.login")}
          </button>
        </form>
        <Show when={submission.result?.error}>
          <p class="alert alert-error">{t("auth.invalid")}</p>
        </Show>
      </div>
    </main>
  );
}
