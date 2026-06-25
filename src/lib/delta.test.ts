import assert from "node:assert/strict";
import { test } from "node:test";
import { pctChange } from "./delta.ts";

test("pctChange: positive and negative whole-percent change", () => {
  assert.equal(pctChange(110, 100), 10);
  assert.equal(pctChange(90, 100), -10);
  assert.equal(pctChange(100, 100), 0);
});

test("pctChange: rounds to whole percent", () => {
  assert.equal(pctChange(133, 100), 33);
  assert.equal(pctChange(1015, 1000), 2); // 1.5% → 2
});

test("pctChange: no meaningful base (zero or negative prev) → null", () => {
  assert.equal(pctChange(100, 0), null);
  assert.equal(pctChange(100, -50), null); // negative net last period: % is misleading
});
