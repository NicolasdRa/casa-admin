import assert from "node:assert/strict";
import { test } from "node:test";
import { listAuditLog, logAudit } from "./audit.ts";
import { makeTestDb } from "./testdb.ts";

test("logAudit records an entry; listAuditLog returns newest-first", () => {
  const db = makeTestDb();
  logAudit(db, { userId: 1, action: "create", entity: "booking" });
  logAudit(db, { userId: 2, action: "update", entity: "expense:5" });
  const log = listAuditLog(db);
  assert.equal(log.length, 2);
  assert.equal(log[0].action, "update"); // most recent first (by id tiebreak)
  assert.equal(log[0].entity, "expense:5");
  assert.equal(log[1].userId, 1);
});

test("logAudit allows a null user (system action)", () => {
  const db = makeTestDb();
  const row = logAudit(db, { userId: null, action: "delete", entity: "booking:9" });
  assert.equal(row.userId, null);
});

test("listAuditLog filters by action", () => {
  const db = makeTestDb();
  logAudit(db, { userId: 1, action: "create", entity: "supplier:1" });
  logAudit(db, { userId: 1, action: "delete", entity: "supplier:1" });
  const deletes = listAuditLog(db, { action: "delete" });
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].action, "delete");
});

test("listAuditLog searches entity by substring (case-insensitive)", () => {
  const db = makeTestDb();
  logAudit(db, { userId: 1, action: "delete", entity: "supplier:7" });
  logAudit(db, { userId: 1, action: "delete", entity: "booking:7" });
  const hits = listAuditLog(db, { entity: "SUPPLIER" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].entity, "supplier:7");
});

test("listAuditLog paginates with limit + offset (newest-first)", () => {
  const db = makeTestDb();
  for (let i = 0; i < 5; i++) logAudit(db, { userId: 1, action: "create", entity: `e:${i}` });
  const page1 = listAuditLog(db, { limit: 2, offset: 0 });
  const page2 = listAuditLog(db, { limit: 2, offset: 2 });
  assert.equal(page1.length, 2);
  assert.equal(page1[0].entity, "e:4"); // newest
  assert.equal(page2[0].entity, "e:2"); // third newest
});
