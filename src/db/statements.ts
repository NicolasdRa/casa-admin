import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { splitByShare } from "../lib/split.ts";
import { accruedCommissionEur, rentalIncomeEur } from "./bookings.ts";
import { listPartners } from "./partners.ts";
import type * as schema from "./schema.ts";
import { ownerSettlement } from "./settlement.ts";

type Db = BetterSQLite3Database<typeof schema>;

export interface PartnerStatement {
  partnerId: number;
  name: string;
  incomeShare: number; // ownership % of rental income (cents)
  commissionShare: number; // ownership % of co-host commission borne by owners
  expenseShare: number; // fair share of attributed expenses (their half of the shared total)
  fronted: number; // expenses this owner actually paid out of pocket (reimbursed to them)
  cashAccount: number; // Caja contributions - withdrawals (signed)
  settle: number; // saldo: incomeShare - commissionShare - expenseShare + fronted + cashAccount
}

/**
 * CA-2/CA-4: per-partner statement / saldo. Each cost is discounted exactly ONCE — income and
 * commission split by ownership %, the fair expense share subtracted once, and what the owner
 * personally fronted added back once (the shared total already deducted it). The Caja cash account
 * folds in too. `settle` is the single coherent payout/collect figure, so the fair share is never
 * subtracted twice (the old result + expenseNet pair double-counted it).
 */
export function partnerStatements(db: Db): PartnerStatement[] {
  const settlement = ownerSettlement(db);
  const owners = listPartners(db);
  const shareTotal = owners.reduce((s, o) => s + o.defaultShare, 0) || 1;
  const shares = owners.map((o) => ({ partnerId: o.id, share: o.defaultShare / shareTotal }));

  const incomeBy = new Map(
    splitByShare(rentalIncomeEur(db), shares).map((x) => [x.partnerId, x.amountEur]),
  );
  const commBy = new Map(
    splitByShare(accruedCommissionEur(db), shares).map((x) => [x.partnerId, x.amountEur]),
  );

  return settlement.owners.map((o) => {
    const incomeShare = incomeBy.get(o.partnerId) ?? 0;
    const commissionShare = commBy.get(o.partnerId) ?? 0;
    return {
      partnerId: o.partnerId,
      name: o.name,
      incomeShare,
      commissionShare,
      expenseShare: o.fairShare,
      fronted: o.fronted,
      cashAccount: o.cashAccount,
      settle: incomeShare - commissionShare - o.fairShare + o.fronted + o.cashAccount,
    };
  });
}
