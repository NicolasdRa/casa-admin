import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

// In-memory DB for tests. DDL mirrors schema.ts — keep in sync (tests break loudly if it drifts).
// Add tables here as new repos get tested.
const DDL = `
CREATE TABLE fx_rates (
  date text PRIMARY KEY NOT NULL,
  compra real NOT NULL,
  venta real NOT NULL,
  average real NOT NULL,
  source text DEFAULT 'BNA' NOT NULL
);
CREATE TABLE bookings (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  date text NOT NULL,
  guest text NOT NULL,
  currency text NOT NULL,
  amount integer NOT NULL,
  fx_rate real NOT NULL,
  fx_rate_date text NOT NULL,
  fx_overridden integer DEFAULT 0 NOT NULL,
  amount_eur integer NOT NULL,
  amount_ars integer NOT NULL,
  commission_rate real NOT NULL,
  commission_eur integer NOT NULL,
  type text DEFAULT 'booking' NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE settings (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  commission_rate real DEFAULT 0.1 NOT NULL,
  fx_source text DEFAULT 'BNA' NOT NULL,
  default_locale text DEFAULT 'es' NOT NULL,
  backup_cadence text DEFAULT 'daily' NOT NULL
);
CREATE TABLE users (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  locale text DEFAULT 'es' NOT NULL,
  status text DEFAULT 'active' NOT NULL,
  partner_id integer
);
CREATE TABLE suppliers (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  name text NOT NULL
);
CREATE TABLE categories (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  name text NOT NULL,
  "group" text NOT NULL
);
CREATE TABLE partners (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  name text NOT NULL,
  default_share real DEFAULT 0.5 NOT NULL
);
CREATE TABLE expenses (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  date text NOT NULL,
  supplier_id integer,
  category_id integer,
  detail text,
  currency text NOT NULL,
  amount integer NOT NULL,
  fx_rate real NOT NULL,
  fx_rate_date text NOT NULL,
  fx_overridden integer DEFAULT 0 NOT NULL,
  amount_eur integer NOT NULL,
  amount_ars integer NOT NULL,
  receipt_url text,
  paid_by_user_id integer,
  reimbursed_at text,
  reimbursed_by_user_id integer,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE cash_entries (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  date text NOT NULL,
  partner_id integer NOT NULL,
  concept text NOT NULL,
  amount_eur integer NOT NULL,
  type text NOT NULL
);
CREATE TABLE maintenance_tasks (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  date text NOT NULL,
  description text NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  season text NOT NULL,
  expense_id integer
);
CREATE TABLE commission_settlements (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  date text NOT NULL,
  amount_eur integer NOT NULL,
  note text
);
`;

export function makeTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(DDL);
  return drizzle(sqlite, { schema });
}
