import { and, desc, eq, like, type SQL } from "drizzle-orm";
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

export interface AuditFilter {
  action?: string;
  entity?: string; // substring match
  limit?: number;
  offset?: number;
}

// ponytail: action + entity-substring + offset paging. No date-range or CSV export —
// add date columns when action+search can't narrow it; export when an auditor needs it offline.
export function listAuditLog(db: Db, f: AuditFilter = {}) {
  const where: SQL[] = [];
  if (f.action) where.push(eq(schema.auditLog.action, f.action));
  if (f.entity) where.push(like(schema.auditLog.entity, `%${f.entity}%`));
  return db
    .select()
    .from(schema.auditLog)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.auditLog.timestamp), desc(schema.auditLog.id))
    .limit(f.limit ?? 200)
    .offset(f.offset ?? 0)
    .all();
}
