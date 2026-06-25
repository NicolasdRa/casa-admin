import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Conventions:
// - Money is stored as INTEGER minor units (cents) to avoid float drift. See lib/fx.ts.
// - Dates are ISO strings ("YYYY-MM-DD") so they sort lexicographically and import cleanly from the sheets.
// - FX snapshot fields (currency, amount, fx_rate, fx_rate_date, amount_eur, amount_ars) are written once and never recomputed.

const id = () => integer("id").primaryKey({ autoIncrement: true });
// sql`` so SQLite evaluates CURRENT_TIMESTAMP at insert; a plain string would store the literal text.
const now = () => text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const property = sqliteTable("property", {
  id: id(),
  name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull().default("EUR"),
});

export const settings = sqliteTable("settings", {
  id: id(),
  commissionRate: real("commission_rate").notNull().default(0.1), // co-host fee, default 10%
  fxSource: text("fx_source").notNull().default("BNA"),
  defaultLocale: text("default_locale").notNull().default("es"),
  backupCadence: text("backup_cadence").notNull().default("daily"),
  // CA-84: per-listing iCal export URLs. The OTAs publish reserved dates here; `ical:fetch` polls
  // them. Null/blank = that channel isn't synced. Money is never carried — dates only.
  airbnbIcalUrl: text("airbnb_ical_url"),
  bookingIcalUrl: text("booking_ical_url"),
  // CA-86: clear days required between stays for the double-booking guard. 0 = back-to-back allowed
  // (same-day turnover is fine: checkout ~noon, checkin ~3pm). >0 reserves N buffer/cleaning days.
  bookingGapDays: integer("booking_gap_days").notNull().default(0),
});

export const users = sqliteTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["superadmin", "admin", "user"] }).notNull(),
  locale: text("locale", { enum: ["es", "en"] })
    .notNull()
    .default("es"),
  status: text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  // EX-8: links an auth account to the owner it represents. Null = co-host (not an owner) → its
  // expenses are reimbursed (EX-9), never part of the owner split.
  partnerId: integer("partner_id").references(() => partners.id),
});

export const partners = sqliteTable("partners", {
  id: id(),
  name: text("name").notNull(),
  defaultShare: real("default_share").notNull().default(0.5), // open Q1: defaults to 50/50, overridable per expense
});

export const suppliers = sqliteTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
});

export const categories = sqliteTable("categories", {
  id: id(),
  name: text("name").notNull(),
  group: text("group", {
    enum: ["operating", "equipment", "maintenance", "taxes", "services"],
  }).notNull(),
});

export const fxRates = sqliteTable("fx_rates", {
  date: text("date").primaryKey(), // ISO date, ARS per 1 EUR
  compra: real("compra").notNull(),
  venta: real("venta").notNull(),
  average: real("average").notNull(), // (compra + venta) / 2
  source: text("source", { enum: ["BNA", "manual"] })
    .notNull()
    .default("BNA"),
});

export const bookings = sqliteTable("bookings", {
  id: id(),
  date: text("date").notNull(), // ISO check-in
  // CA-83: ISO check-out. Nullable — legacy/imported rows only carry a check-in. When set it must
  // be strictly after `date` (enforced in createBooking). Enables range calendar + iCal sync.
  checkOut: text("check_out"),
  guest: text("guest").notNull(),
  currency: text("currency", { enum: ["ARS", "EUR"] }).notNull(),
  amount: integer("amount").notNull(), // cents in `currency`
  fxRate: real("fx_rate").notNull(),
  fxRateDate: text("fx_rate_date").notNull(),
  fxOverridden: integer("fx_overridden", { mode: "boolean" }).notNull().default(false),
  amountEur: integer("amount_eur").notNull(), // cents
  amountArs: integer("amount_ars").notNull(), // cents
  commissionRate: real("commission_rate").notNull(), // snapshotted from settings
  commissionEur: integer("commission_eur").notNull(), // cents, accrues to co-host
  // The co-host (role "user") whose commission this booking accrues to. Nullable: legacy rows
  // predate the relation (backfilled to the sole co-host) and the field is optional on entry.
  coHostUserId: integer("co_host_user_id").references(() => users.id),
  // "damage" = a guest paying for damage they caused (real money in). NOT "reimbursement" — that
  // word is reserved for the co-host expense-reimbursement flow (expenses.reimbursed_*).
  type: text("type", { enum: ["booking", "cancellation", "damage"] })
    .notNull()
    .default("booking"),
  // BK: source channel. "direct" = entered by hand / owned site; OTAs are tracked so income and
  // calendar can be split by channel. Money is always entered manually (OTA APIs don't expose it).
  channel: text("channel", { enum: ["direct", "booking", "airbnb"] })
    .notNull()
    .default("direct"),
  createdAt: now(),
});

export const expenses = sqliteTable("expenses", {
  id: id(),
  date: text("date").notNull(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  categoryId: integer("category_id").references(() => categories.id),
  detail: text("detail"),
  currency: text("currency", { enum: ["ARS", "EUR"] }).notNull(),
  amount: integer("amount").notNull(), // cents in `currency`
  fxRate: real("fx_rate").notNull(),
  fxRateDate: text("fx_rate_date").notNull(),
  fxOverridden: integer("fx_overridden", { mode: "boolean" }).notNull().default(false),
  amountEur: integer("amount_eur").notNull(), // cents
  amountArs: integer("amount_ars").notNull(), // cents
  receiptUrl: text("receipt_url"),
  // EX-8: who fronted this expense in full. Null = unattributed (import/blank) → excluded from the
  // owner settlement until a payer is assigned. The owner split is derived at the balance, not here.
  paidByUserId: integer("paid_by_user_id").references(() => users.id),
  // EX-9: co-host-paid expenses get reimbursed by an admin. Set → the cost transfers to the
  // reimbursing owner (who then counts as the fronter for settlement).
  reimbursedAt: text("reimbursed_at"), // ISO date, null = not reimbursed
  reimbursedByUserId: integer("reimbursed_by_user_id").references(() => users.id),
  createdAt: now(),
});

export const cashEntries = sqliteTable("cash_entries", {
  id: id(),
  date: text("date").notNull(),
  partnerId: integer("partner_id")
    .notNull()
    .references(() => partners.id),
  concept: text("concept").notNull(),
  amountEur: integer("amount_eur").notNull(), // signed cents; +contribution/allocation/income, -withdrawal
  type: text("type", { enum: ["contribution", "withdrawal", "allocation", "income"] }).notNull(),
  // Set only on "income" entries: the booking whose rent this cash receipt records. Bookings stay the
  // single source of truth for the income column — this link just dedupes the receipt so a booking
  // can't be marked paid twice (one row per booking; partnerId is who pocketed it).
  bookingId: integer("booking_id").references(() => bookings.id),
});

export const commissionSettlements = sqliteTable("commission_settlements", {
  id: id(),
  date: text("date").notNull(),
  // The co-host (role "user") this payment settles. Nullable: legacy rows predate the relation.
  coHostUserId: integer("co_host_user_id").references(() => users.id),
  amountEur: integer("amount_eur").notNull(), // cents settled to co-host
  note: text("note"),
});

export const maintenanceTasks = sqliteTable("maintenance_tasks", {
  id: id(),
  date: text("date"), // nullable: a dateless task is an unscheduled pending, sorted on top (CA-127)
  description: text("description").notNull(),
  status: text("status", { enum: ["pending", "done"] })
    .notNull()
    .default("pending"),
  season: text("season").notNull(), // e.g. "2026"
  expenseId: integer("expense_id").references(() => expenses.id),
});

// CA-84: reserved/blocked date ranges imported from OTA iCal feeds. Keyed on the VEVENT UID so a
// re-fetch updates in place instead of duplicating (idempotent poll). Carries dates only — never
// money or guest PII (the feeds don't expose them). Consumed by the double-booking guard (CA-86).
export const externalReservations = sqliteTable("external_reservations", {
  uid: text("uid").primaryKey(), // VEVENT UID from the feed
  channel: text("channel", { enum: ["booking", "airbnb"] }).notNull(),
  start: text("start").notNull(), // ISO check-in / block start
  end: text("end").notNull(), // ISO check-out (exclusive — see lib/overlap.ts)
  summary: text("summary"), // raw VEVENT SUMMARY, e.g. "Reserved" / "Not available"
  fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLog = sqliteTable("audit_log", {
  id: id(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  timestamp: now(),
});

export const backups = sqliteTable("backups", {
  id: id(),
  path: text("path").notNull(),
  size: integer("size"),
  status: text("status", { enum: ["ok", "failed"] })
    .notNull()
    .default("ok"),
  createdAt: now(),
});
