import assert from "node:assert/strict";
import { test } from "node:test";
import { toCsv } from "./csv.ts";

test("toCsv joins rows and escapes commas/quotes/newlines", () => {
  const out = toCsv([
    ["date", "detail", "eur"],
    ["2026-06-18", 'he"llo, world', 12345],
  ]);
  assert.equal(out, 'date,detail,eur\r\n2026-06-18,"he""llo, world",12345');
});
