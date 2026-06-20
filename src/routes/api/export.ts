import type { APIEvent } from "@solidjs/start/server";
import { db } from "~/db/index";
import { annualPnl, biMonetaryEntries, multiYearBalance } from "~/db/reports";
import { toCsv } from "~/lib/csv";
import { fromCents } from "~/lib/money";
import { currentUser } from "~/lib/session";

const eur = (c: number) => fromCents(c).toFixed(2);

// RP-5: CSV export (Excel-native). Co-host (role "user") may export the bi-monetary ledger but not
// net-result reports (P&L / balance). PDF is handled client-side via the browser's print dialog.
export async function GET(event: APIEvent) {
  const me = await currentUser();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const url = new URL(event.request.url);
  const report = url.searchParams.get("report") ?? "";
  const isCohost = me.role === "user";
  let rows: (string | number)[][] | null = null;

  if (report === "entries") {
    rows = [
      ["date", "kind", "detail", "ars", "eur", "fxRate", "fxRateDate"],
      ...biMonetaryEntries(db).map((r) => [
        r.date,
        r.kind,
        r.detail,
        eur(r.ars),
        eur(r.eur),
        r.fxRate,
        r.fxRateDate,
      ]),
    ];
  } else if (report === "pnl" && !isCohost) {
    const y = url.searchParams.get("year") ?? "";
    const p = annualPnl(db, y);
    rows = [
      ["P&L", y],
      ["Income", eur(p.income)],
      ["Commission", eur(p.commission)],
      ...p.expensesByGroup.map((g) => [`Expenses: ${g.group}`, eur(g.eur)]),
      ["Total expenses", eur(p.totalExpenses)],
      ["Net result", eur(p.netResult)],
    ];
  } else if (report === "balance" && !isCohost) {
    rows = [
      ["year", "income", "expenses", "commission", "net", "cumulative"],
      ...multiYearBalance(db).map((b) => [
        b.year,
        eur(b.income),
        eur(b.expenses),
        eur(b.commission),
        eur(b.net),
        eur(b.cumulative),
      ]),
    ];
  }

  if (!rows) return new Response("Forbidden", { status: 403 });
  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${report}.csv"`,
    },
  });
}
