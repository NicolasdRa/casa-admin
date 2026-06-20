import assert from "node:assert/strict";
import { test } from "node:test";
import { sparkline } from "./sparkline.ts";

test("empty -> empty string", () => {
  assert.equal(sparkline([]), "");
});

test("single value -> centred point", () => {
  assert.equal(sparkline([5], 120, 28), "0,14.0");
});

test("ascending values map min->bottom, max->top, evenly spaced", () => {
  const pts = sparkline([1, 2, 3], 120, 28).split(" ");
  assert.equal(pts.length, 3);
  assert.equal(pts[0], "0.0,28.0"); // min at bottom (y=height)
  assert.equal(pts[1], "60.0,14.0"); // middle
  assert.equal(pts[2], "120.0,0.0"); // max at top (y=0)
});
