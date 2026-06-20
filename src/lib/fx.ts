// FX core. BNA quotes are ARS per 1 EUR.
//   average = (compra + venta) / 2
//   EUR = ARS / rate     ARS = EUR * rate
// All money is integer cents. The snapshot is computed once at entry and stored immutably.

export type Currency = "ARS" | "EUR";

export const bnaAverage = (compra: number, venta: number) => (compra + venta) / 2;

export interface FxSnapshot {
  amountEur: number; // cents
  amountArs: number; // cents
}

/**
 * Convert an entered amount (in cents of `currency`) into both currencies at `rate` (ARS per EUR).
 * The entered side is preserved exactly; only the other side is derived and rounded to the nearest cent.
 */
export function snapshot(amountCents: number, currency: Currency, rate: number): FxSnapshot {
  if (!Number.isInteger(amountCents)) throw new Error("amount must be integer cents");
  if (!(rate > 0)) throw new Error("rate must be positive");
  return currency === "EUR"
    ? { amountEur: amountCents, amountArs: Math.round(amountCents * rate) }
    : { amountArs: amountCents, amountEur: Math.round(amountCents / rate) };
}

export const commissionEur = (amountEurCents: number, commissionRate: number) =>
  Math.round(amountEurCents * commissionRate);

/**
 * Pick the BNA rate to apply for an entry `date` (ISO "YYYY-MM-DD"): the quote with the
 * greatest date on or before `date`. Weekends/holidays have no quote, so they fall back to
 * the most recent prior one. Returns null when no quote exists at/before the date (caller
 * must then prompt for a manual rate, see FX-7). Input need not be sorted.
 * ISO date strings sort chronologically, so this is a plain string compare — no Date objects.
 */
export function resolveRate<T extends { date: string }>(date: string, rates: T[]): T | null {
  return rates.reduce<T | null>(
    (best, r) => (r.date <= date && (best === null || r.date > best.date) ? r : best),
    null,
  );
}
