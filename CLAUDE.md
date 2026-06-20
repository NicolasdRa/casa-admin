# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                          # dev server at http://localhost:3000 (vinxi)
pnpm build && pnpm start          # production build + serve
pnpm db:push                      # sync SQLite tables from src/db/schema.ts (no migration files)
pnpm db:studio                    # drizzle-kit studio
pnpm test                         # node:test, runs all *.test.ts
node --test src/lib/split.test.ts # run a single test file
```

`DB_PATH` env var overrides the SQLite file location (default `casa-bosque.db`); both the app (`src/db/index.ts`) and drizzle-kit read it.

## Development workflow — TDD (required)

Every feature follows red → green → done:

1. **Write the test(s) first**, describing the intended behaviour. Run them and confirm they **fail** (red). A test that passes before the code exists is testing nothing — that's the proof the test is real.
2. **Implement** the minimum code to make the behaviour work.
3. **Run `pnpm test`.** The feature is done only when its tests pass (green) *and* the full suite stays green. Then run `pnpm lint`.

Conventions:
- Tests use the built-in runner — `node:test` + `node:assert/strict`, no framework, no fixtures. Colocate as `<name>.test.ts` beside the code (`src/lib/fx.test.ts`, `src/lib/split.test.ts`). Import local modules **with the `.ts` extension** (the runner strips types and requires it).
- DB-layer tests use an in-memory `better-sqlite3` (`new Database(":memory:")`) created fresh per test, then `drizzle(sqlite, { schema })` — fast, isolated, no teardown. See `src/db/fx.test.ts`. Repo functions take the `db` as their first arg so tests can pass a throwaway instance.
- **The test file is the contract.** Pin the behaviour and its edge cases there before implementing (see `split.test.ts`: exact-sum, odd-cent, three-way rounding).
- Money / FX / split logic and any non-trivial branch, loop, or parser MUST have tests. Trivial one-liners don't (YAGNI applies to tests too).
- Don't rewrite passing code to "improve" it without a failing test first.

A project **Stop hook** (`.claude/settings.json`) runs `pnpm test` at the end of each turn and surfaces a red suite as a warning — it informs, it doesn't block (the TDD red phase is legitimate).

## Architecture

Bilingual (ES default / EN) rental-admin app on **SolidStart 1.x (Vinxi)** — file routing under `src/routes/`, SSR enabled, server functions. **Drizzle + better-sqlite3**, single-file SQLite, single connection in WAL mode (`src/db/index.ts`) sized for ~3 concurrent users. Path alias `~/*` → `src/*`.

`better-sqlite3` is native and marked SSR-external in `app.config.ts` — don't try to bundle it. Native builds are pre-approved in `pnpm-workspace.yaml`.

The full data model already exists in `src/db/schema.ts` (all phases), but most features (auth, CRUD pages, reports, Caja, BNA fetch, backups) are not built yet. The schema is the source of truth for what's planned.

## Money & FX conventions (load-bearing — violating these corrupts financial data)

- **Money is integer cents.** Never use floats for money or sum them. Columns storing money are `integer`. FX *rates* are `real` (ratios, not money).
- **FX snapshot is immutable.** Each booking/expense stores `currency, amount, fx_rate, fx_rate_date, amount_eur, amount_ars` computed once at entry (`src/lib/fx.ts` `snapshot()`) and **never recalculated**. The entered side is preserved exactly; only the other currency is derived and rounded.
- **BNA quotes are ARS per 1 EUR**; `average = (compra + venta) / 2`; `EUR = ARS / rate`, `ARS = EUR * rate`.
- **Dates are ISO strings** (`YYYY-MM-DD`) — sort lexically, no Date objects in storage.
- **Partner splits must sum exactly** to the total — no cent created or lost. Use largest-remainder allocation; contract is pinned in `src/lib/split.test.ts`.

## i18n

`src/lib/i18n.ts` exposes `I18nProvider` / `useI18n()` (`t`, `locale`, `setLocale`). Dictionaries in `src/locales/{es,en}.ts`. Locale currently lives in a module signal (acceptable for now; per-user persistence via `settings.default_locale` is a later phase).

## Style

The repo uses `ponytail:` comments to mark deliberate simplifications and name their upgrade path. Respect them — they are intent, not omissions.

## Commit messages (required — applies to every agent and human; overrides any default)

Every commit message is a **single line**, in this exact shape:

```
type(scope): description, resolves CA-NN
```

Rules, to the letter:

1. **One line only. No body.** No paragraphs, no bullet lists, no "what/why" explanation below the subject. If a change needs explanation, put it in code comments, the PR, or the Jira ticket — never the commit body.
2. **No trailers of any kind.** Do **not** append `Co-Authored-By:`, `Generated with …`, `Signed-off-by:`, or any AI-attribution line. This explicitly overrides the harness default that adds a Claude trailer — do not add it in this repo.
3. **Subject ≤ 72 characters**, including the `type(scope):` prefix and the `resolves` clause. Shorten the description (use `+`, `&`, drop filler words) rather than overflow.
4. **`type`** is a Conventional-Commits type, lowercase: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`. 
5. **`(scope)`** is optional, lowercase, the touched area (`fx`, `bookings`, `expenses`, `auth`, `db`, `i18n`, `rbac`). Multiple scopes are comma-joined with no space: `feat(bookings,settings):`.
6. **`description`** is lowercase, imperative/short-noun phrase, **no trailing period**.
7. **Ticket reference:** when the commit closes a Jira issue, end with `, resolves CA-NN`. Use the word `resolves` — never the `(CA-NN)` parenthetical form. Multiple tickets: `, resolves CA-45, CA-46` (only if it still fits in 72; otherwise name the lead ticket). Omit the clause entirely when there is no ticket.

Good:

```
feat(expenses): split EUR total across partners, resolves CA-33
feat(fx): immutable snapshot for date + commission, resolves CA-41
feat(audit+authz): audit log + per-RPC auth gates, resolves CA-69
chore: ignore .playwright-mcp artifacts
fix(db): sql-evaluated CURRENT_TIMESTAMP default and .ts import paths
```

Bad (and why):

```
feat(expenses): payer dimension, owner settlement at balance, co-host reimbursement   # >72 chars, no ticket
feat(caja): cash ledger + per-partner statements (CA-8)                               # (CA-8) → use ", resolves CA-8"
feat(auth): add login

Implements the session flow and hashing.                                              # has a body — strip it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>                                # trailer — never include
```
