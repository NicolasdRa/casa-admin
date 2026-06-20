import { desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface AuditEntry {
  userId: number | null;
  action: string; // "create" | "update" | "delete"
  entity: string; // e.g. "booking", "expense:12"
}

/** Append an audit record (pure — no session). The timestamp defaults at the DB. */
export function logAudit(db: Db, entry: AuditEntry) {
  const [row] = db.insert(schema.auditLog).values(entry).returning().all();
  return row;
}

export function listAuditLog(db: Db, limit = 200) {
  return db
    .select()
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.timestamp), desc(schema.auditLog.id))
    .limit(limit)
    .all();
}
