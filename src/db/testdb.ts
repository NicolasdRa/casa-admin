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
CREATE TABLE users (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  locale text DEFAULT 'es' NOT NULL,
  status text DEFAULT 'active' NOT NULL
);
CREATE TABLE suppliers (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  name text NOT NULL
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
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
`;

export function makeTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(DDL);
  return drizzle(sqlite, { schema });
}
