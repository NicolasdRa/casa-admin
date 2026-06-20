import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./password.ts";

test("hashPassword/verifyPassword round-trips", () => {
  const stored = hashPassword("correct horse");
  assert.equal(verifyPassword("correct horse", stored), true);
});

test("verifyPassword rejects the wrong password", () => {
  const stored = hashPassword("s3cret");
  assert.equal(verifyPassword("wrong", stored), false);
});

test("each hash uses a fresh salt (no two identical)", () => {
  assert.notEqual(hashPassword("same"), hashPassword("same"));
});

test("verifyPassword returns false (no throw) on malformed stored value", () => {
  assert.equal(verifyPassword("x", "not-a-valid-hash"), false);
  assert.equal(verifyPassword("x", ""), false);
});
