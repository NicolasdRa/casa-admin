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
  date: text("date").notNull(),
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
  type: text("type", { enum: ["booking", "cancellation", "reimbursement"] })
    .notNull()
    .default("booking"),
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
  createdAt: now(),
});

export const expenseSplits = sqliteTable("expense_splits", {
  id: id(),
  expenseId: integer("expense_id")
    .notNull()
    .references(() => expenses.id, { onDelete: "cascade" }),
  partnerId: integer("partner_id")
    .notNull()
    .references(() => partners.id),
  amountEur: integer("amount_eur").notNull(), // resolved cents this partner owes (see lib/split.ts)
});

export const cashEntries = sqliteTable("cash_entries", {
  id: id(),
  date: text("date").notNull(),
  partnerId: integer("partner_id")
    .notNull()
    .references(() => partners.id),
  concept: text("concept").notNull(),
  amountEur: integer("amount_eur").notNull(), // signed cents; +contribution/allocation, -withdrawal
  type: text("type", { enum: ["contribution", "withdrawal", "allocation"] }).notNull(),
});

export const commissionSettlements = sqliteTable("commission_settlements", {
  id: id(),
  date: text("date").notNull(),
  amountEur: integer("amount_eur").notNull(), // cents settled to co-host
  note: text("note"),
});

export const maintenanceTasks = sqliteTable("maintenance_tasks", {
  id: id(),
  date: text("date").notNull(),
  description: text("description").notNull(),
  status: text("status", { enum: ["pending", "done"] })
    .notNull()
    .default("pending"),
  season: text("season").notNull(), // e.g. "2026"
  expenseId: integer("expense_id").references(() => expenses.id),
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
