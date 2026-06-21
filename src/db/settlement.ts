import { and, eq, isNotNull, isNull, like } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { splitByShare } from "../lib/split.ts";
import { createCashEntry } from "./cash.ts";
import { getExpenseById, listExpenses } from "./expenses.ts";
import { listPartners } from "./partners.ts";
import * as schema from "./schema.ts";
import { listUsers } from "./users.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface OwnerSettlement {
  partnerId: number;
  name: string;
  fairShare: number; // cents owed under ownership %
  fronted: number; // cents this owner actually paid (lifetime; the +credit in the saldo)
  expenseNet: number; // fronted - fairShare; >0 owed back, <0 owes. Sums to 0 across owners.
  cashAccount: number; // separate line: signed Caja movements (contributions - withdrawals)
}

export interface SettlementResult {
  owners: OwnerSettlement[];
  unattributed: { count: number; totalEur: number }; // null-payer expenses, excluded until assigned
}

/**
 * CA-77: derive the owner split once, in aggregate, at the final balance — replacing per-expense
 * splits (EX-11). Each expense is fronted in full by one owner; we net what each fronted against
 * their fair share of the shared total.
 *
 * Locked decisions:
 *  - All attributed expenses are shared by ownership % (no personal/non-shared expenses).
 *  - A co-host expense joins the pool only once reimbursed, fronted by the *reimbursing* owner (EX-9).
 *  - Expenses with no payer (null `paidByUserId`, not reimbursed) are excluded from both the shared
 *    total and `fronted`, and reported in `unattributed` so the balance stays cent-exact (Σ net = 0).
 *  - Expense net and the Caja cash account are reported as two separate lines, never merged.
 */
export function ownerSettlement(db: Db): SettlementResult {
  const owners = listPartners(db);
  const partnerByUser = new Map(listUsers(db).map((u) => [u.id, u.partnerId]));
  const expenses = listExpenses(db);

  // Fronter = the owner partner who ultimately paid: the reimburser if reimbursed, else the payer.
  const fronterPartnerId = (e: (typeof expenses)[number]): number | null => {
    if (e.reimbursedByUserId != null) return partnerByUser.get(e.reimbursedByUserId) ?? null;
    if (e.paidByUserId != null) return partnerByUser.get(e.paidByUserId) ?? null;
    return null;
  };

  const fronted = new Map<number, number>(owners.map((o) => [o.id, 0]));
  let sharedTotal = 0;
  const unattributed = { count: 0, totalEur: 0 };

  for (const e of expenses) {
    const fronter = fronterPartnerId(e);
    if (fronter != null && fronted.has(fronter)) {
      sharedTotal += e.amountEur;
      fronted.set(fronter, (fronted.get(fronter) ?? 0) + e.amountEur);
    } else if (e.paidByUserId == null && e.reimbursedByUserId == null) {
      // genuinely unattributed (import/blank) — assign a payer to include
      unattributed.count++;
      unattributed.totalEur += e.amountEur;
    }
    // else: co-host-fronted, pending reimbursement — out of the owner split until reimbursed (EX-9)
  }

  // fair share = ownership % of the shared total, allocated once with no lost cents.
  const shareTotal = owners.reduce((s, o) => s + o.defaultShare, 0) || 1;
  const shares = splitByShare(
    sharedTotal,
    owners.map((o) => ({ partnerId: o.id, share: o.defaultShare / shareTotal })),
  );
  const fairShareById = new Map(shares.map((s) => [s.partnerId, s.amountEur]));

  const cashByPartner = new Map<number, number>(owners.map((o) => [o.id, 0]));
  for (const c of db.select().from(schema.cashEntries).all()) {
    if (cashByPartner.has(c.partnerId))
      cashByPartner.set(c.partnerId, (cashByPartner.get(c.partnerId) ?? 0) + c.amountEur);
  }

  return {
    owners: owners.map((o) => {
      const fairShare = fairShareById.get(o.id) ?? 0;
      const f = fronted.get(o.id) ?? 0;
      return {
        partnerId: o.id,
        name: o.name,
        fairShare,
        fronted: f,
        expenseNet: f - fairShare,
        cashAccount: cashByPartner.get(o.id) ?? 0,
      };
    }),
    unattributed,
  };
}

/**
 * EX-12: settle a single owner-fronted expense by recording the repayment that already happened —
 * one Caja withdrawal to the paying owner for that expense's amount, dated when the money left the
 * box (the settlement date, NOT the expense date), so the running balance stays truthful. The
 * expense is marked reimbursed so it can't be settled twice. It stays a shared cost; only the
 * owner's +fronted credit is cancelled — by the new cash line, not by editing fronted.
 *
 * Returns null (no-op) when the expense can't be self-settled: already reimbursed, unattributed, or
 * paid by a co-host (that's the reimburse flow in markExpenseReimbursed, which transfers the cost).
 */
export function settleExpense(db: Db, expenseId: number, date: string) {
  const e = getExpenseById(db, expenseId);
  if (!e || e.reimbursedAt != null || e.paidByUserId == null) return null;
  const partnerByUser = new Map(listUsers(db).map((u) => [u.id, u.partnerId]));
  const partnerId = partnerByUser.get(e.paidByUserId);
  if (partnerId == null) return null; // payer is a co-host, not an owner
  // ponytail: ES concept (default locale); auto-generated ledger text isn't localised yet.
  const entry = createCashEntry(db, {
    date,
    partnerId,
    concept: `Reembolso gasto: ${e.detail ?? e.date}`,
    type: "withdrawal",
    amountEur: -e.amountEur,
  });
  db.update(schema.expenses)
    .set({ reimbursedAt: date })
    .where(eq(schema.expenses.id, expenseId))
    .run();
  return { entry };
}

/**
 * EX-12 one-time backfill: settle every owner-fronted, not-yet-reimbursed expense, dating each Caja
 * withdrawal to that expense's OWN recorded date (the real repayment dates are lost, so the expense
 * date is the truthful proxy). Idempotent — already-reimbursed expenses are skipped, so a re-run only
 * finishes what a partial run left. `apply: false` previews (counts, writes nothing).
 *
 * `force: true` rewrites even already-settled expenses: it first wipes the prior settle artifacts
 * (the `Reembolso gasto:` cash entries + the owner-settle flags) and re-settles all owner-fronted
 * expenses by expense date. Use it to repair settles made with the wrong date (e.g. UI clicks that
 * stamped today). Wipe-then-redo, because cash entries carry no expense link to update in place.
 * ponytail: re-derives partnerByUser per expense via settleExpense; fine for a one-shot pass.
 */
export function backfillSettleExpenses(db: Db, opts: { apply: boolean; force?: boolean }) {
  if (opts.apply && opts.force) {
    db.delete(schema.cashEntries)
      .where(like(schema.cashEntries.concept, "Reembolso gasto:%"))
      .run();
    db.update(schema.expenses)
      .set({ reimbursedAt: null })
      .where(
        and(isNotNull(schema.expenses.reimbursedAt), isNull(schema.expenses.reimbursedByUserId)),
      )
      .run();
  }
  const partnerByUser = new Map(listUsers(db).map((u) => [u.id, u.partnerId]));
  const targets = listExpenses(db).filter(
    (e) =>
      e.paidByUserId != null &&
      partnerByUser.get(e.paidByUserId) != null &&
      (opts.force || e.reimbursedAt == null),
  );
  let totalEur = 0;
  for (const e of targets) {
    totalEur += e.amountEur;
    if (opts.apply) settleExpense(db, e.id, e.date);
  }
  return { count: targets.length, totalEur };
}
