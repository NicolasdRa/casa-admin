import { and, desc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { CodedError } from "../lib/errors.ts";
import { assertIsoDate } from "../lib/validate.ts";
import * as schema from "./schema.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface NewTask {
  date?: string | null; // ISO, optional — a dateless task is an unscheduled pending (CA-127)
  description: string;
  season: string; // e.g. "2026"
  status?: "pending" | "done";
  expenseId?: number; // MT-3: optional link to the resulting expense
}

export function createTask(db: Db, input: NewTask) {
  if (input.date) assertIsoDate(input.date);
  const description = input.description.trim();
  if (!description) throw new CodedError("invalid", "task description required");
  const [row] = db
    .insert(schema.maintenanceTasks)
    .values({
      date: input.date || null,
      description,
      season: input.season,
      status: input.status ?? "pending",
      expenseId: input.expenseId ?? null,
    })
    .returning()
    .all();
  return row;
}

export interface TaskEdit {
  date?: string | null;
  description: string;
  season: string;
  expenseId?: number | null;
}

export function editTask(db: Db, id: number, input: TaskEdit) {
  if (input.date) assertIsoDate(input.date);
  const description = input.description.trim();
  if (!description) throw new CodedError("invalid", "task description required");
  const [row] = db
    .update(schema.maintenanceTasks)
    .set({
      date: input.date || null,
      description,
      season: input.season,
      expenseId: input.expenseId ?? null,
    })
    .where(eq(schema.maintenanceTasks.id, id))
    .returning()
    .all();
  return row;
}

export function deleteTask(db: Db, id: number) {
  db.delete(schema.maintenanceTasks).where(eq(schema.maintenanceTasks.id, id)).run();
}

export interface TaskFilter {
  season?: string;
  status?: "pending" | "done";
}

export function listTasks(db: Db, filter: TaskFilter = {}) {
  const conds = [];
  if (filter.season) conds.push(eq(schema.maintenanceTasks.season, filter.season));
  if (filter.status) conds.push(eq(schema.maintenanceTasks.status, filter.status));
  return (
    db
      .select()
      .from(schema.maintenanceTasks)
      .where(conds.length ? and(...conds) : undefined)
      // Dateless (unscheduled) tasks float to the top; the rest newest-first (CA-127). SQLite sorts
      // NULL as smallest, so a plain DESC would sink them — the `IS NULL DESC` key lifts them instead.
      .orderBy(
        sql`${schema.maintenanceTasks.date} is null desc`,
        desc(schema.maintenanceTasks.date),
      )
      .all()
  );
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
