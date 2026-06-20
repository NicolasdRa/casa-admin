# Casa Bosque — Rental Administration

Bilingual (ES/EN) SolidStart app replacing the Excel workflow. See the PRD for full scope.

## Stack
- **SolidStart 1.x** (Vinxi) — file routing, SSR, server functions
- **better-sqlite3 + Drizzle** — single-file SQLite DB (`casa-bosque.db`)
- **@solid-primitives/i18n** — ES default, EN available

## Develop
```bash
pnpm install        # native builds are pre-approved in pnpm-workspace.yaml
pnpm db:push        # create/sync tables from src/db/schema.ts
pnpm dev            # http://localhost:3000
pnpm test           # node:test — FX + split money-path checks
pnpm lint           # Biome — lint + format check
pnpm lint:fix       # Biome — apply safe fixes + format
```
`DB_PATH` env var overrides the DB file location (used for backups/restore later).

## What's built (Phase 1 foundation)
- Full data model in `src/db/schema.ts` (Section 5 of the PRD)
- **FX core** `src/lib/fx.ts` — BNA average + immutable snapshot, tested
- i18n scaffold `src/lib/i18n.ts` + `src/locales/{es,en}.ts`
- Dashboard placeholder at `/`

## Conventions
- **Money is integer cents.** Sums never touch floats. FX *rates* are REAL (ratios, not money).
- **Dates are ISO strings** (`YYYY-MM-DD`) — sort lexically, import cleanly from sheets.
- **FX snapshot is immutable**: each booking/expense stores `currency, amount, fx_rate, fx_rate_date, amount_eur, amount_ars`, computed once at entry and never recalculated.

## Open questions — defaults chosen (override anytime)
| PRD Q | Default baked in | Where |
|---|---|---|
| 1. Partner split | 50/50, overridable per expense | `partners.default_share = 0.5` |
| 2. BNA EUR basis | *Undecided* — `fx_rates` stores compra/venta/average; pick Billete vs Divisa when wiring the BNA fetch | `src/db/schema.ts` |
| 3. Backup cadence | `daily` (Phase 3, not yet implemented) | `settings.backup_cadence` |
| 4. Payout currency | Both ARS & EUR supported per entry | `bookings.currency` enum |

## Not built yet (later phases)
Auth/roles, CRUD pages, server functions, P&L/balance reports, Caja, BNA auto-fetch,
history import, backups, Hetzner deploy. The schema already has tables for all of them.
