import assert from "node:assert/strict";
import { test } from "node:test";
import { breakdown, totalEur } from "./expenseSummary.ts";

// Minimal rows — the helper only needs amountEur plus whatever the key/label fns read.
const row = (amountEur: number, supplierId: number | null) => ({ amountEur, supplierId });
const bySupplier = (rows: ReturnType<typeof row>[], topN = Infinity) =>
  breakdown(
    rows,
    (r) => (r.supplierId == null ? "" : String(r.supplierId)),
    (r) => (r.supplierId == null ? "Unassigned" : `S${r.supplierId}`),
    topN,
  );

const sliceSum = (b: { slices: { amountEur: number }[] }) =>
  b.slices.reduce((a, s) => a + s.amountEur, 0);

test("totalEur sums integer cents", () => {
  assert.equal(totalEur([row(10050, 1), row(2500, 2)]), 12550);
  assert.equal(totalEur([]), 0);
});

test("groups by key, sorted by amount descending", () => {
  const b = bySupplier([row(1000, 1), row(5000, 2), row(2000, 1)]);
  assert.equal(b.total, 8000);
  assert.deepEqual(
    b.slices.map((s) => [s.label, s.amountEur]),
    [
      ["S2", 5000],
      ["S1", 3000], // two rows for supplier 1 merged
    ],
  );
});

test("null key lands in the Unassigned bucket and is counted", () => {
  const b = bySupplier([row(3000, null), row(1000, 1)]);
  assert.equal(b.total, 4000);
  const unassigned = b.slices.find((s) => s.label === "Unassigned");
  assert.equal(unassigned?.amountEur, 3000);
  assert.equal(sliceSum(b), 4000); // null bucket included — slices reconcile to total
});

test("slices always sum exactly to the total", () => {
  const b = bySupplier([row(3333, 1), row(3333, 2), row(3334, 3), row(1000, null)]);
  assert.equal(b.total, 11000);
  assert.equal(sliceSum(b), 11000);
});

test("top-N rollup: keep N biggest, rest collapse into exact Other", () => {
  const b = bySupplier([row(5000, 1), row(4000, 2), row(3000, 3), row(2000, 4), row(1000, 5)], 3);
  assert.equal(b.total, 15000);
  assert.equal(b.slices.length, 4); // 3 + Other
  const other = b.slices.at(-1);
  assert.equal(other?.label, "Other");
  assert.equal(other?.amountEur, 3000); // 2000 + 1000, exactly total - top3
  assert.equal(sliceSum(b), 15000); // Other keeps the sum honest
});

test("no Other slice when groups fit within topN", () => {
  const b = bySupplier([row(5000, 1), row(4000, 2)], 6);
  assert.equal(b.slices.length, 2);
  assert.ok(!b.slices.some((s) => s.label === "Other"));
});

test("percentages reflect share of total", () => {
  const b = bySupplier([row(7500, 1), row(2500, 2)]);
  assert.equal(b.slices.find((s) => s.label === "S1")?.pct, 75);
  assert.equal(b.slices.find((s) => s.label === "S2")?.pct, 25);
});

test("empty input yields zeroes, never NaN", () => {
  const b = bySupplier([]);
  assert.equal(b.total, 0);
  assert.deepEqual(b.slices, []);
});
