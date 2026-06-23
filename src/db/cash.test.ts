import assert from "node:assert/strict";
import { test } from "node:test";
import { createCashEntry, deleteCashEntry, listCashLedger } from "./cash.ts";
import { makeTestDb } from "./testdb.ts";

test("createCashEntry stores a signed entry; rejects empty concept", () => {
  const db = makeTestDb();
  const e = createCashEntry(db, {
    date: "2026-01-01",
    partnerId: 1,
    concept: "Aporte",
    amountEur: 5000,
    type: "contribution",
  });
  assert.equal(e.amountEur, 5000);
  assert.throws(() =>
    createCashEntry(db, {
      date: "2026-01-01",
      partnerId: 1,
      concept: " ",
      amountEur: 1,
      type: "contribution",
    }),
  );
});

test("listCashLedger returns a cumulative running balance in date order", () => {
  const db = makeTestDb();
  createCashEntry(db, {
    date: "2026-02-01",
    partnerId: 1,
    concept: "Retiro",
    amountEur: -2000,
    type: "withdrawal",
  });
  createCashEntry(db, {
    date: "2026-01-01",
    partnerId: 1,
    concept: "Aporte",
    amountEur: 5000,
    type: "contribution",
  });
  const led = listCashLedger(db);
  assert.equal(led[0].concept, "Aporte"); // earliest first
  assert.equal(led[0].runningBalance, 5000);
  assert.equal(led[1].runningBalance, 3000);
});

test("deleteCashEntry removes a mistyped entry; balance recomputes", () => {
  const db = makeTestDb();
  const keep = createCashEntry(db, {
    date: "2026-01-01",
    partnerId: 1,
    concept: "Aporte",
    amountEur: 5000,
    type: "contribution",
  });
  const oops = createCashEntry(db, {
    date: "2026-01-02",
    partnerId: 1,
    concept: "Error",
    amountEur: 9999,
    type: "contribution",
  });
  deleteCashEntry(db, oops.id);
  const led = listCashLedger(db);
  assert.equal(led.length, 1);
  assert.equal(led[0].id, keep.id);
  assert.equal(led[0].runningBalance, 5000);
});
