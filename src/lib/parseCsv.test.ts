import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv } from "./parseCsv.ts";

test("splits plain rows and cells", () => {
  assert.deepEqual(parseCsv("a,b,c\r\n1,2,3"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("keeps empty trailing/leading cells", () => {
  assert.deepEqual(parseCsv(",2026,,"), [["", "2026", "", ""]]);
});

test("quoted cell containing a comma (European decimal) is one field", () => {
  assert.deepEqual(parseCsv('1,6.1.2026,Mariano,"€462,68","€46,27"'), [
    ["1", "6.1.2026", "Mariano", "€462,68", "€46,27"],
  ]);
});

test("escaped doubled quotes inside a quoted cell", () => {
  assert.deepEqual(parseCsv('"Autoservicio ""El Capo""",x'), [['Autoservicio "El Capo"', "x"]]);
});

test("newline inside a quoted cell stays in the field", () => {
  assert.deepEqual(parseCsv('"line1\nline2",b'), [["line1\nline2", "b"]]);
});

test("handles bare \\n line endings and a trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\nc,d\n"), [
    ["a", "b"],
    ["c", "d"],
  ]);
});
