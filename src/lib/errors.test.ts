import assert from "node:assert/strict";
import { test } from "node:test";
import { CodedError, errorCode } from "./errors.ts";

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

test("a CodedError short-circuits the table — its code is used verbatim", () => {
  // The whole point of CA candidate-2: the code lives at the throw site, not in a needle table.
  assert.equal(
    errorCode(new CodedError("reimburserNotOwner", "reimburser must be an owner"), table),
    "reimburserNotOwner",
  );
  // ...even with an empty table, so a fully-migrated module needs no table at all.
  assert.equal(errorCode(new CodedError("inUse", "category is in use"), []), "inUse");
});

test("CodedError keeps the human message for logs", () => {
  const e = new CodedError("notFound", "expense not found");
  assert.ok(e instanceof Error);
  assert.equal(e.message, "expense not found");
  assert.equal(e.code, "notFound");
});
