/** Inclusive ISO (YYYY-MM-DD) date-range test. An empty/undefined bound leaves that side open.
 *  Dates sort lexically, so plain string comparison is chronological — no Date objects. */
export function inDateRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
