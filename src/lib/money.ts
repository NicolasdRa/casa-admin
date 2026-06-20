// Major units <-> integer cents at the input/display boundary. Storage & math stay in cents.

/** e.g. 100.5 -> 10050. Rounds sub-cent input; rejects NaN/Infinity (empty form fields). */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error("amount must be a finite number");
  return Math.round(amount * 100);
}

/** e.g. 10050 -> 100.5, for display only. */
export const fromCents = (cents: number) => cents / 100;
