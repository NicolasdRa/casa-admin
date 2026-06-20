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
