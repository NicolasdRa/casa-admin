// CA-86: the double-booking predicate. Two stays conflict if they share at least one night.
// Stays are half-open intervals [start, end) — `end` is the check-out date, which is available for
// the next guest's check-in (checkout ~noon, checkin ~3pm), so same-day turnover is NOT a conflict.
// All dates are ISO "YYYY-MM-DD" strings; because they sort lexically, `<` on the strings IS the
// date compare — except when shifting by a day count, which needs real calendar arithmetic below.

/** Shift an ISO date by whole days (UTC, leap/month-rollover-aware). gapDays 0 returns it as-is.
 *  ponytail: bna.ts has its own private copy for the BNA window; not worth a shared module for two
 *  3-line call sites. Extract to lib/dates.ts if a third caller appears. */
function addDays(iso: string, days: number): string {
  if (days === 0) return iso;
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Return true if [aStart, aEnd) and [bStart, bEnd) overlap, requiring `gapDays` clear days between
 * stays (default 0 = back-to-back allowed). The gap widens each stay's exclusive end, so with gap 1
 * a checkout on the 5th conflicts with a check-in on the 5th OR 6th, but the 7th is fine.
 */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
  gapDays = 0,
): boolean {
  return bStart < addDays(aEnd, gapDays) && aStart < addDays(bEnd, gapDays);
}
