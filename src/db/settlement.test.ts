import assert from "node:assert/strict";
import { test } from "node:test";
import { createExpense, markExpenseReimbursed } from "./expenses.ts";
import { upsertFxRate } from "./fx.ts";
import { createPartner } from "./partners.ts";
import * as schema from "./schema.ts";
import { ownerSettlement } from "./settlement.ts";
import { makeTestDb } from "./testdb.ts";
import { createUser } from "./users.ts";

// Two owners (50/50), each with an owner-user, plus a co-host (no partner mapping).
function setup() {
  const db = makeTestDb();
  upsertFxRate(db, { date: "2026-06-18", compra: 1000, venta: 1100 });
  const nico = createPartner(db, { name: "Nicolás", defaultShare: 0.5 });
  const ana = createPartner(db, { name: "Anastasia", defaultShare: 0.5 });
  const uNico = createUser(db, {
    name: "Nicolás",
    email: "n@x.test",
    passwordHash: "h",
    role: "admin",
    partnerId: nico.id,
  });
  const uAna = createUser(db, {
    name: "Anastasia",
    email: "a@x.test",
    passwordHash: "h",
    role: "admin",
    partnerId: ana.id,
  });
  const cohost = createUser(db, {
    name: "Co-host",
    email: "c@x.test",
    passwordHash: "h",
    role: "user",
  });
  const eur = (cents: number, paidByUserId?: number) =>
    createExpense(db, { date: "2026-06-18", currency: "EUR", amount: cents, paidByUserId });
  return { db, nico, ana, uNico, uAna, cohost, eur };
}

const net = (r: ReturnType<typeof ownerSettlement>, partnerId: number) =>
  r.owners.find((o) => o.partnerId === partnerId)!;

test("50/50, one owner fronts everything → ±half, sums to zero (CA-77)", () => {
  const { db, nico, ana, uNico, eur } = setup();
  eur(10000, uNico.id);
  eur(20000, uNico.id); // Nicolás fronts 300.00 total
  const r = ownerSettlement(db);
  assert.equal(net(r, nico.id).fairShare, 15000);
  assert.equal(net(r, nico.id).fronted, 30000);
  assert.equal(net(r, nico.id).expenseNet, 15000);
  assert.equal(net(r, ana.id).expenseNet, -15000);
  assert.equal(
    r.owners.reduce((s, o) => s + o.expenseNet, 0),
    0,
  );
});

test("odd cent: fair share allocation never loses a cent (CA-77)", () => {
  const { db, uNico, eur } = setup();
  eur(10001, uNico.id); // 100.01 → 50.00 / 50.01 (largest remainder)
  const r = ownerSettlement(db);
  assert.equal(
    r.owners.reduce((s, o) => s + o.fairShare, 0),
    10001,
  );
  assert.equal(
    r.owners.reduce((s, o) => s + o.expenseNet, 0),
    0,
  );
});

test("reimbursed co-host expense is fronted by the reimbursing owner (EX-9 → CA-77)", () => {
  const { db, nico, ana, uAna, cohost, eur } = setup();
  const e = eur(4000, cohost.id); // co-host fronts; pending → not in the pool yet
  let r = ownerSettlement(db);
  assert.equal(net(r, nico.id).fronted, 0);
  assert.equal(net(r, ana.id).fronted, 0);
  // Anastasia (owner) reimburses → cost transfers to her
  markExpenseReimbursed(db, e.id, uAna.id, "2026-06-20");
  r = ownerSettlement(db);
  assert.equal(net(r, ana.id).fronted, 4000);
  assert.equal(net(r, ana.id).expenseNet, 2000); // 4000 fronted − 2000 fair share
  assert.equal(net(r, nico.id).expenseNet, -2000);
});

test("null-payer expenses are excluded and counted as unattributed (CA-77)", () => {
  const { db, nico, eur } = setup();
  eur(5000); // no payer
  eur(300); // no payer
  const r = ownerSettlement(db);
  assert.equal(net(r, nico.id).fairShare, 0); // nothing attributed → empty pool
  assert.equal(r.unattributed.count, 2);
  assert.equal(r.unattributed.totalEur, 5300);
});

test("cashAccount is computed from cash_entries as a separate line (CA-77)", () => {
  const { db, nico, ana } = setup();
  db.insert(schema.cashEntries)
    .values([
      {
        date: "2026-06-18",
        partnerId: nico.id,
        concept: "aporte",
        amountEur: 50000,
        type: "contribution",
      },
      {
        date: "2026-06-19",
        partnerId: nico.id,
        concept: "retiro",
        amountEur: -20000,
        type: "withdrawal",
      },
    ])
    .run();
  const r = ownerSettlement(db);
  assert.equal(net(r, nico.id).cashAccount, 30000); // 500 − 200
  assert.equal(net(r, ana.id).cashAccount, 0);
  // cash account is independent of the (empty) expense settlement
  assert.equal(net(r, nico.id).expenseNet, 0);
});
