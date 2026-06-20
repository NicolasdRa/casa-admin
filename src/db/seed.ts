// Dev seed: a few recent BNA rates so the bookings form works before FX-8 (auto-fetch) exists.
// Run: pnpm db:seed   (idempotent — upserts by date)
import { hashPassword } from "../lib/password.ts";
import { upsertFxRate } from "./fx.ts";
import { db } from "./index.ts";
import { createPartner, listPartners } from "./partners.ts";
import { categories } from "./schema.ts";
import { createUser, listUsers } from "./users.ts";

const rates = [
  { date: "2026-06-17", compra: 1175, venta: 1215 },
  { date: "2026-06-18", compra: 1180, venta: 1220 },
  { date: "2026-06-19", compra: 1185, venta: 1225 },
  { date: "2026-06-20", compra: 1190, venta: 1230 },
];

for (const r of rates) upsertFxRate(db, r);
console.log(`seeded ${rates.length} fx rates (${rates[0].date}..${rates.at(-1)?.date})`);

// Default expense categories (one per group). Idempotent — only seeds an empty table.
const defaultCategories = [
  { name: "Operativo", group: "operating" as const },
  { name: "Equipamiento", group: "equipment" as const },
  { name: "Mantenimiento", group: "maintenance" as const },
  { name: "Impuestos", group: "taxes" as const },
  { name: "Servicios", group: "services" as const },
];
if (db.select().from(categories).all().length === 0) {
  db.insert(categories).values(defaultCategories).run();
  console.log(`seeded ${defaultCategories.length} categories`);
}

// Owner partners between whom expenses/results split (default 50/50). Idempotent.
if (listPartners(db).length === 0) {
  createPartner(db, { name: "Nicolás", defaultShare: 0.5 });
  createPartner(db, { name: "Anastasia", defaultShare: 0.5 });
  console.log("seeded 2 partners (50/50)");
}

// PRD §3 role accounts. Placeholder emails for Anastasia/co-host — change them, and the temp
// password, after first login. Idempotent — only seeds an empty users table.
const TEMP_PASSWORD = "changeme123";
// EX-8: owner accounts map to the partner they represent; the co-host has no partner mapping.
const partnerByName = new Map(listPartners(db).map((p) => [p.name, p.id]));
const users = [
  { name: "Admin", email: "ndr@nuuk.de", role: "superadmin" as const },
  { name: "Nicolás", email: "nicolasdirago@gmail.com", role: "admin" as const, partner: "Nicolás" },
  {
    name: "Anastasia",
    email: "anastasia@casabosque.local",
    role: "admin" as const,
    partner: "Anastasia",
  },
  { name: "Co-host", email: "cohost@casabosque.local", role: "user" as const },
];
if (listUsers(db).length === 0) {
  const passwordHash = hashPassword(TEMP_PASSWORD);
  for (const { partner, ...u } of users)
    createUser(db, {
      ...u,
      passwordHash,
      partnerId: partner ? partnerByName.get(partner) : undefined,
    });
  console.log(
    `seeded ${users.length} users — TEMP PASSWORD for all: "${TEMP_PASSWORD}" (change after first login)`,
  );
}
