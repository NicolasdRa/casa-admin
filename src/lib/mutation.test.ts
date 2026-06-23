import assert from "node:assert/strict";
import { test } from "node:test";
import { runMutation } from "./mutation.ts";

const ERRORS: [string, string][] = [["must be an owner", "reimburserNotOwner"]];

test("success: runs work, then records audit, returns ok", async () => {
  const calls: string[] = [];
  const audited: [string, string][] = [];
  const res = await runMutation(
    { audit: ["update", "expense"], errors: ERRORS },
    () => calls.push("work"),
    async (a, e) => {
      audited.push([a, e]);
    },
  );
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(calls, ["work"]);
  assert.deepEqual(audited, [["update", "expense"]]);
});

test("failure: work throws -> audit NOT recorded, error mapped to code", async () => {
  const audited: unknown[] = [];
  const res = await runMutation(
    { audit: ["update", "expense"], errors: ERRORS },
    () => {
      throw new Error("reimburser must be an owner");
    },
    async (a, e) => {
      audited.push([a, e]);
    },
  );
  assert.deepEqual(res, { error: "reimburserNotOwner" });
  assert.equal(audited.length, 0, "audit must not fire when the mutation fails");
});

test("failure: unmapped message falls back to generic", async () => {
  const res = await runMutation(
    { audit: ["create", "expense"], errors: ERRORS },
    () => {
      throw new Error("disk on fire");
    },
    async () => {},
  );
  assert.deepEqual(res, { error: "generic" });
});

test("audit fires after work completes (ordering)", async () => {
  const order: string[] = [];
  await runMutation(
    { audit: ["delete", "category"], errors: [] },
    async () => {
      await Promise.resolve();
      order.push("work");
    },
    async () => {
      order.push("audit");
    },
  );
  assert.deepEqual(order, ["work", "audit"]);
});
