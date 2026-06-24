import { count, eq, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { CodedError } from "../lib/errors.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
  role: "superadmin" | "admin" | "user";
  locale?: "es" | "en";
  partnerId?: number; // EX-8: owner this account represents; omit for the co-host
}

export function createUser(db: Db, u: NewUser) {
  const [row] = db
    .insert(schema.users)
    .values({
      ...u,
      email: u.email.toLowerCase(),
      locale: u.locale ?? "es",
      partnerId: u.partnerId ?? null,
    })
    .returning()
    .all();
  return row;
}

export function getUserByEmail(db: Db, email: string) {
  return (
    db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase())).get() ?? null
  );
}

export function getUserById(db: Db, id: number) {
  return db.select().from(schema.users).where(eq(schema.users.id, id)).get() ?? null;
}

export function listUsers(db: Db) {
  return db.select().from(schema.users).all();
}

export type UserPatch = Partial<{
  name: string;
  role: "superadmin" | "admin" | "user";
  locale: "es" | "en";
  status: "active" | "disabled";
  partnerId: number | null;
}>;

export function updateUser(db: Db, id: number, patch: UserPatch) {
  const [row] = db.update(schema.users).set(patch).where(eq(schema.users.id, id)).returning().all();
  return row;
}

/** Hard-delete a user. Refuses when the account has any history — expenses it paid or reimbursed,
 *  or audit-log entries it authored — because orphaning those rows loses financial attribution and
 *  the accountability trail. Disable the account (status) instead to revoke access while keeping the
 *  history. A freshly-created account that never acted has no refs and deletes cleanly. */
export function deleteUser(db: Db, id: number) {
  const [{ n: expenseRefs }] = db
    .select({ n: count() })
    .from(schema.expenses)
    .where(or(eq(schema.expenses.paidByUserId, id), eq(schema.expenses.reimbursedByUserId, id)))
    .all();
  const [{ n: auditRefs }] = db
    .select({ n: count() })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.userId, id))
    .all();
  if (expenseRefs + auditRefs > 0)
    throw new CodedError("inUse", `user has ${expenseRefs + auditRefs} linked record(s)`);
  db.delete(schema.users).where(eq(schema.users.id, id)).run();
}

/** Bulk-delete users, all-or-nothing: the transaction rolls back if *any* id still has history,
 *  so a partial delete can never leave the selection half-applied (CA-112). The self / last-active-
 *  superadmin lockout guard lives in the route action (userDeleteError). */
export function deleteUsers(db: Db, ids: number[]) {
  db.transaction((tx) => {
    for (const id of ids) deleteUser(tx, id);
  });
}

/** Reset a user's password. Credential mutation kept separate from the role/status patch so a
 *  password hash can never be set through the general UserPatch path. Caller hashes first. */
export function setPassword(db: Db, id: number, passwordHash: string) {
  const [row] = db
    .update(schema.users)
    .set({ passwordHash })
    .where(eq(schema.users.id, id))
    .returning()
    .all();
  return row;
}
