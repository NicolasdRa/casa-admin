import { and, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { assertIsoDate } from "../lib/validate.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewTask {
  date: string; // ISO
  description: string;
  season: string; // e.g. "2026"
  status?: "pending" | "done";
  expenseId?: number; // MT-3: optional link to the resulting expense
}

export function createTask(db: Db, input: NewTask) {
  assertIsoDate(input.date);
  const description = input.description.trim();
  if (!description) throw new Error("task description required");
  const [row] = db
    .insert(schema.maintenanceTasks)
    .values({
      date: input.date,
      description,
      season: input.season,
      status: input.status ?? "pending",
      expenseId: input.expenseId ?? null,
    })
    .returning()
    .all();
  return row;
}

export interface TaskFilter {
  season?: string;
  status?: "pending" | "done";
}

export function listTasks(db: Db, filter: TaskFilter = {}) {
  const conds = [];
  if (filter.season) conds.push(eq(schema.maintenanceTasks.season, filter.season));
  if (filter.status) conds.push(eq(schema.maintenanceTasks.status, filter.status));
  return db
    .select()
    .from(schema.maintenanceTasks)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.maintenanceTasks.date))
    .all();
}

export function setTaskStatus(db: Db, id: number, status: "pending" | "done") {
  const [row] = db
    .update(schema.maintenanceTasks)
    .set({ status })
    .where(eq(schema.maintenanceTasks.id, id))
    .returning()
    .all();
  return row;
}

/** Distinct seasons present, newest first (for grouping/filter options). */
export function listSeasons(db: Db): string[] {
  const seasons = new Set(listTasks(db).map((t) => t.season));
  return [...seasons].sort((a, b) => b.localeCompare(a));
}
