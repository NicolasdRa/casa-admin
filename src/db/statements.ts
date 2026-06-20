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
  expenseShare: number; // fair share of attributed expenses
  result: number; // incomeShare - commissionShare - expenseShare (their P&L share)
  fronted: number; // expenses this owner actually paid
  expenseNet: number; // fronted - expenseShare (cash owed/owing on expenses)
  cashAccount: number; // Caja contributions - withdrawals
}

/**
 * CA-2/CA-4: per-partner statement. Income and commission are split by ownership %% (cent-exact);
 * expense fair-share / fronted / net and the Caja cash account come from the owner settlement.
 * Expense net and cash account are kept as separate lines (never merged), matching the settlement.
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
      result: incomeShare - commissionShare - o.fairShare,
      fronted: o.fronted,
      expenseNet: o.expenseNet,
      cashAccount: o.cashAccount,
    };
  });
}
