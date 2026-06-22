import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
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
