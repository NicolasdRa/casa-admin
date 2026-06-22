import assert from "node:assert/strict";
import { test } from "node:test";
import { errorCode } from "./errors.ts";

const table: [string, string][] = [
  ["No FX rate", "fxNoRate"],
  ["invalid date", "dateInvalid"],
  ["already exists", "duplicate"],
];

test("returns the code whose needle the message contains", () => {
  assert.equal(errorCode(new Error("No FX rate for 2026-06-22"), table), "fxNoRate");
  // needle may sit mid-message (the old suppliers mapper relied on this)
  assert.equal(errorCode(new Error("name already exists in db"), table), "duplicate");
});

test("falls back to 'generic' when nothing matches", () => {
  assert.equal(errorCode(new Error("boom"), table), "generic");
});

test("checks the table in order — first match wins, so put specific needles first", () => {
  const t2: [string, string][] = [
    ["invalid", "broad"],
    ["invalid date", "specific"],
  ];
  assert.equal(errorCode(new Error("invalid date"), t2), "broad");
});

test("stringifies non-Error inputs instead of throwing", () => {
  assert.equal(errorCode("No FX rate today", table), "fxNoRate");
  assert.equal(errorCode(null, table), "generic");
});
