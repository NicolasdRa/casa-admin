// CA-70: shared input validators for amounts, dates and currencies. Throw on invalid input so
// callers fail loudly rather than persisting garbage. Referential integrity is enforced separately
// by the schema's foreign keys + `PRAGMA foreign_keys = ON` (see db/index.ts).

/** Assert a real ISO calendar date "YYYY-MM-DD" (rejects 2026-13-40 etc.). Returns it. */
export function assertIsoDate(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`invalid date: ${s}`);
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`invalid date: ${s}`);
  }
  return s;
}

/** Assert a supported currency. Returns the narrowed type. */
export function assertCurrency(s: string): "ARS" | "EUR" {
  if (s !== "ARS" && s !== "EUR") throw new Error(`invalid currency: ${s}`);
  return s;
}

/** Assert a supported booking channel. Returns the narrowed type. */
export function assertChannel(s: string): "direct" | "booking" | "airbnb" {
  if (s !== "direct" && s !== "booking" && s !== "airbnb") throw new Error(`invalid channel: ${s}`);
  return s;
}

/** Assert a positive integer amount in minor units (cents). Returns it. */
export function assertPositiveCents(cents: number): number {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error(`invalid amount: ${cents}`);
  return cents;
}
