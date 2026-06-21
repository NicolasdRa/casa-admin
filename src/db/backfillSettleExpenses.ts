// EX-12 one-time backfill: repay owners for every expense they fronted, recording one Caja
// withdrawal per expense dated the expense's OWN recorded date. Idempotent and safe to re-run.
//   Preview:  node src/db/backfillSettleExpenses.ts
//   Apply:    node src/db/backfillSettleExpenses.ts --apply
//   Repair:   node src/db/backfillSettleExpenses.ts --apply --force
//             (wipes prior settle entries + re-settles ALL by expense date — fixes wrong dates)
// Respects DB_PATH (defaults to casa-bosque.db).
import { fromCents } from "../lib/money.ts";
import { db } from "./index.ts";
import { backfillSettleExpenses } from "./settlement.ts";

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");
const res = backfillSettleExpenses(db, { apply, force });
const eur = fromCents(res.totalEur).toFixed(2);

if (apply) {
  const how = force ? "rewrote (force)" : "settled";
  console.log(`backfill applied: ${how} ${res.count} owner-fronted expenses (${eur} EUR total),`);
  console.log("each Caja withdrawal dated its own expense date.");
} else {
  const note = force ? " (force: would rewrite already-settled too)" : "";
  console.log(
    `DRY RUN — ${res.count} owner-fronted expenses would be settled (${eur} EUR)${note}.`,
  );
  console.log("Re-run with --apply to write the cash movements.");
}
