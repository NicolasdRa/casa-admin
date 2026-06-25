/** Percent change of `cur` vs `prev`, rounded to whole percent.
 *  Returns null when `prev <= 0` — there's no meaningful base to form a percentage against
 *  (a zero or negative prior period would make the % nonsense). Callers render "—" / nothing.
 *  ponytail: whole-percent is enough for a glanceable delta; no decimals. */
export function pctChange(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}
