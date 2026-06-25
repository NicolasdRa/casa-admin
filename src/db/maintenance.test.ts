import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTask,
  deleteTask,
  editTask,
  listSeasons,
  listTasks,
  setTaskStatus,
} from "./maintenance.ts";
import { makeTestDb } from "./testdb.ts";

test("createTask defaults to pending; rejects empty description", () => {
  const db = makeTestDb();
  const t = createTask(db, { date: "2026-05-01", description: "  Pintar  ", season: "2026" });
  assert.equal(t.description, "Pintar");
  assert.equal(t.status, "pending");
  assert.equal(t.season, "2026");
  assert.throws(() => createTask(db, { date: "2026-05-01", description: " ", season: "2026" }));
});

test("createTask allows no date — a dateless task is an unscheduled pending (CA-127)", () => {
  const db = makeTestDb();
  const t = createTask(db, { description: "Sin fecha", season: "2026" });
  assert.equal(t.date, null);
  assert.equal(t.status, "pending");
});

test("listTasks sorts dateless tasks on top, then by date desc (CA-127)", () => {
  const db = makeTestDb();
  createTask(db, { date: "2026-05-01", description: "A", season: "2026" });
  createTask(db, { description: "B", season: "2026" }); // no date
  createTask(db, { date: "2026-06-01", description: "C", season: "2026" });
  assert.deepEqual(
    listTasks(db).map((t) => t.description),
    ["B", "C", "A"],
  );
});

test("editTask updates fields, can clear the date, rejects empty description (CA-127)", () => {
  const db = makeTestDb();
  const t = createTask(db, { date: "2026-05-01", description: "A", season: "2026" });
  const u = editTask(db, t.id, { date: "2026-07-01", description: "  A2 ", season: "2027" });
  assert.equal(u.description, "A2");
  assert.equal(u.date, "2026-07-01");
  assert.equal(u.season, "2027");
  assert.equal(editTask(db, t.id, { description: "A3", season: "2027" }).date, null);
  assert.throws(() => editTask(db, t.id, { description: " ", season: "2027" }));
});

test("deleteTask removes the row", () => {
  const db = makeTestDb();
  const t = createTask(db, { date: "2026-05-01", description: "A", season: "2026" });
  deleteTask(db, t.id);
  assert.equal(listTasks(db).length, 0);
});

test("listTasks filters by season and status", () => {
  const db = makeTestDb();
  createTask(db, { date: "2026-05-01", description: "A", season: "2026" });
  createTask(db, { date: "2025-05-01", description: "B", season: "2025" });
  createTask(db, { date: "2026-04-01", description: "C", season: "2026", status: "done" });
  assert.equal(listTasks(db, { season: "2026" }).length, 2);
  assert.equal(listTasks(db, { status: "done" }).length, 1);
  assert.equal(listTasks(db, { season: "2026", status: "pending" }).length, 1);
});

test("setTaskStatus toggles pending/done", () => {
  const db = makeTestDb();
  const t = createTask(db, { date: "2026-05-01", description: "A", season: "2026" });
  assert.equal(setTaskStatus(db, t.id, "done").status, "done");
});

test("listSeasons returns distinct seasons newest-first", () => {
  const db = makeTestDb();
  createTask(db, { date: "2025-05-01", description: "A", season: "2025" });
  createTask(db, { date: "2026-05-01", description: "B", season: "2026" });
  createTask(db, { date: "2026-06-01", description: "C", season: "2026" });
  assert.deepEqual(listSeasons(db), ["2026", "2025"]);
});
