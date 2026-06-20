import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// ponytail: single-file DB, single connection. WAL keeps the ~3 concurrent users from blocking each other.
const sqlite = new Database(process.env.DB_PATH ?? "casa-bosque.db");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
