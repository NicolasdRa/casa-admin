// CA-119: expenses summary aggregation. Pure money math, kept out of the JSX so it's testable.
// Totals are EUR-only — summing per-row ARS across different FX snapshots would be meaningless.
// Gross: every row counts regardless of reimbursement status (settlement is a separate screen).

export type Slice = { key: string; label: string; amountEur: number; pct: number };
export type Breakdown = { total: number; slices: Slice[] };

/** Grand/filtered total — sum of integer cents, exact by construction. */
export const totalEur = (rows: readonly { amountEur: number }[]) =>
  rows.reduce((s, r) => s + r.amountEur, 0);

/**
 * Group rows into pie slices by a dimension (supplier / payer / category).
 * - `keyOf` returns "" for the null bucket; `labelOf` supplies its display name ("Unassigned").
 * - Sorted by amount desc; the smallest groups beyond `topN` collapse into one "Other" slice
 *   (best practice — a pie stays readable; `Other = total - sum(topN)` keeps the sum honest).
 * - Slice amounts always reconcile to `total`; only `pct` is rounded (display only).
 */
export function breakdown<T extends { amountEur: number }>(
  rows: readonly T[],
  keyOf: (r: T) => string,
  labelOf: (r: T) => string,
  topN = Infinity,
  otherLabel = "Other",
): Breakdown {
  const groups = new Map<string, { label: string; amountEur: number }>();
  for (const r of rows) {
    const key = keyOf(r);
    const g = groups.get(key);
    if (g) g.amountEur += r.amountEur;
    else groups.set(key, { label: labelOf(r), amountEur: r.amountEur });
  }

  const total = totalEur(rows);
  const sorted = [...groups.entries()].sort((a, b) => b[1].amountEur - a[1].amountEur);

  let kept = sorted;
  let other: { amountEur: number } | null = null;
  if (sorted.length > topN) {
    kept = sorted.slice(0, topN);
    const rest = sorted.slice(topN);
    other = { amountEur: rest.reduce((s, [, g]) => s + g.amountEur, 0) };
  }

  const pct = (amountEur: number) => (total === 0 ? 0 : (amountEur / total) * 100);
  const slices: Slice[] = kept.map(([key, g]) => ({
    key,
    label: g.label,
    amountEur: g.amountEur,
    pct: pct(g.amountEur),
  }));
  if (other) {
    slices.push({
      key: "__other__",
      label: otherLabel,
      amountEur: other.amountEur,
      pct: pct(other.amountEur),
    });
  }
  return { total, slices };
}
