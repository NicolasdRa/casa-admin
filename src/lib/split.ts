// Resolve an expense's EUR total (cents) into per-partner amounts.
// EX-3: split by share (percentages) OR explicit amounts; the result MUST sum back to `totalEur` exactly.

export interface ShareInput {
  partnerId: number;
  share: number;
} // shares are fractions, should sum to ~1
export interface SplitResult {
  partnerId: number;
  amountEur: number;
} // cents

/**
 * Split `totalEur` cents across partners by their `share` fraction.
 *
 * Contract (see split.test.ts):
 *  - Output sums EXACTLY to totalEur — no cent created or lost.
 *  - Each partner gets floor(total * share); leftover cents go to the largest fractional remainders first.
 *  - Deterministic for a given input order.
 *
 * TODO(nicolás): implement the largest-remainder allocation. ~8 lines.
 *  Hint: compute exact = total * share for each; floored = Math.floor(exact);
 *  distribute (total - sum(floored)) cents to the partners with the biggest (exact - floored).
 */
export function splitByShare(totalEur: number, shares: ShareInput[]): SplitResult[] {
  const rows = shares.map((s) => {
    const exact = totalEur * s.share;
    const floored = Math.floor(exact);
    return { partnerId: s.partnerId, amountEur: floored, remainder: exact - floored };
  });
  const leftover = totalEur - rows.reduce((a, r) => a + r.amountEur, 0);
  // Largest remainder first; stable sort keeps input order on ties (deterministic).
  [...rows]
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, leftover)
    .forEach((r) => {
      r.amountEur++;
    });
  return rows.map(({ partnerId, amountEur }) => ({ partnerId, amountEur }));
}
