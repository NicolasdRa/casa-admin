import assert from "node:assert/strict";
import { test } from "node:test";
import { splitByShare } from "./split.ts";

const sum = (rows: { amountEur: number }[]) => rows.reduce((a, r) => a + r.amountEur, 0);

test("clean 50/50 split", () => {
  const r = splitByShare(10000, [
    { partnerId: 1, share: 0.5 },
    { partnerId: 2, share: 0.5 },
  ]);
  assert.deepEqual(r, [
    { partnerId: 1, amountEur: 5000 },
    { partnerId: 2, amountEur: 5000 },
  ]);
});

test("odd cent never lost: 50/50 of 100.01 EUR sums exactly", () => {
  const r = splitByShare(10001, [
    { partnerId: 1, share: 0.5 },
    { partnerId: 2, share: 0.5 },
  ]);
  assert.equal(sum(r), 10001); // largest-remainder gives one partner the extra cent
});

test("three-way 1/3 split of 100.00 sums exactly", () => {
  const r = splitByShare(10000, [
    { partnerId: 1, share: 1 / 3 },
    { partnerId: 2, share: 1 / 3 },
    { partnerId: 3, share: 1 / 3 },
  ]);
  assert.equal(sum(r), 10000); // 3334 + 3333 + 3333
});

test("uneven shares sum exactly", () => {
  const r = splitByShare(9999, [
    { partnerId: 1, share: 0.7 },
    { partnerId: 2, share: 0.3 },
  ]);
  assert.equal(sum(r), 9999);
});
