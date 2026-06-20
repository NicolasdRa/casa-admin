import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { splitByShare } from "../lib/split.ts";
import { listExpenses } from "./expenses.ts";
import { listPartners } from "./partners.ts";
import * as schema from "./schema.ts";
import { listUsers } from "./users.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface OwnerSettlement {
  partnerId: number;
  name: string;
  fairShare: number; // cents owed under ownership %
  fronted: number; // cents this owner actually paid
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
