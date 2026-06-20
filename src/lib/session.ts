import { redirect } from "@solidjs/router";
import { useSession } from "vinxi/http";
import { logAudit } from "~/db/audit";
import { db } from "~/db/index";
import { getUserById } from "~/db/users";

// Server-only. Sealed-cookie session holding just the user id. Set SESSION_SECRET in production
// (>=32 chars); the dev fallback is intentionally obvious so it isn't mistaken for secure.
interface SessionData {
  userId?: number;
}
const password = process.env.SESSION_SECRET ?? "dev-insecure-session-secret-change-me-please!";

const getSession = () => useSession<SessionData>({ password });

export async function setSessionUser(userId: number) {
  await (await getSession()).update({ userId });
}

export async function clearSession() {
  await (await getSession()).clear();
}

/** The logged-in user (sans password hash), or null. */
export async function currentUser() {
  const { userId } = (await getSession()).data;
  if (!userId) return null;
  const u = getUserById(db, userId);
  if (!u) return null;
  if (u.status !== "active") return null;
  const { passwordHash: _omit, ...safe } = u;
  return safe;
}

/** Guard for server functions: returns the user or throws a redirect to /login. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw redirect("/login");
  return user;
}

/** CA-69: record an audit entry attributed to the current user (call after a successful mutation). */
export async function recordAudit(action: "create" | "update" | "delete", entity: string) {
  const user = await currentUser();
  logAudit(db, { userId: user?.id ?? null, action, entity });
}
