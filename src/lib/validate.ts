// CA-70: shared input validators for amounts, dates and currencies. Throw on invalid input so
// callers fail loudly rather than persisting garbage. Referential integrity is enforced separately
// by the schema's foreign keys + `PRAGMA foreign_keys = ON` (see db/index.ts).
// CA candidate-2: throw CodedError so the i18n code rides on the throw (expenses + bookings routes
// both translate `<ns>.err_<code>` in their own namespace; the codes here are shared across them).

import { CodedError } from "./errors.ts";

/** Assert a real ISO calendar date "YYYY-MM-DD" (rejects 2026-13-40 etc.). Returns it. */
export function assertIsoDate(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new CodedError("dateInvalid", `invalid date: ${s}`);
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new CodedError("dateInvalid", `invalid date: ${s}`);
  }
  return s;
}

/** Assert a supported currency. Returns the narrowed type. */
export function assertCurrency(s: string): "ARS" | "EUR" {
  if (s !== "ARS" && s !== "EUR") throw new CodedError("currencyInvalid", `invalid currency: ${s}`);
  return s;
}

/** Assert a supported booking channel. Returns the narrowed type. */
export function assertChannel(s: string): "direct" | "booking" | "airbnb" {
  if (s !== "direct" && s !== "booking" && s !== "airbnb")
    throw new CodedError("channelInvalid", `invalid channel: ${s}`);
  return s;
}

/** Assert a positive integer amount in minor units (cents). Returns it. */
export function assertPositiveCents(cents: number): number {
  if (!Number.isInteger(cents) || cents <= 0)
    throw new CodedError("amountInvalid", `invalid amount: ${cents}`);
  return cents;
}
