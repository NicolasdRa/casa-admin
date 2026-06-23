// Major units <-> integer cents at the input/display boundary. Storage & math stay in cents.

/** e.g. 100.5 -> 10050. Rounds sub-cent input; rejects NaN/Infinity (empty form fields). */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error("amount must be a finite number");
  return Math.round(amount * 100);
}

/** e.g. 10050 -> 100.5, for display only. */
export const fromCents = (cents: number) => cents / 100;

// One formatter per locale — Intl.NumberFormat construction is the costly part,
// .format() is cheap, and tables call this per cell.
const fmt: Record<string, Intl.NumberFormat> = {};

/**
 * Integer cents -> display string, grouped thousands + 2 decimals, locale-correct
 * decimal mark (es: "45.000,00", en: "45,000.00"). No currency symbol — callers
 * append € / EUR / ARS. Not for CSV (use raw fromCents().toFixed there).
 */
export function formatMoney(cents: number, locale: string): string {
  fmt[locale] ??= new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return fmt[locale].format(fromCents(cents));
}
