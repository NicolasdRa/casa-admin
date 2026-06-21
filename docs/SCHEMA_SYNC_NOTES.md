# Schema sync — expense payer / settlement refactor (CA-73…CA-77)

This refactor changed the schema in three ways (see `src/db/schema.ts`):

- `users` + `partner_id` (nullable) — owner mapping; null = co-host.
- `expenses` + `paid_by_user_id`, `reimbursed_at`, `reimbursed_by_user_id` (all nullable).
- dropped the `expense_splits` table (split now derived at the balance, see `settlement.ts`).

## `pnpm db:push` fails on this change — expected

`drizzle-kit push` can't apply "add columns **and** drop a table" together on SQLite. To
drop a column/table it rebuilds the table by copying rows into a `__new_*` temp table, and
that copy references the new columns before they exist:

```
SqliteError: no such column: "paid_by_user_id"
```

It fails **after** already dropping `expense_splits`, leaving a partial state + an orphaned
`__new_expenses` table.

## Apply it manually instead (idempotent, no rebuild)

All new columns are nullable, so plain `ALTER TABLE ... ADD COLUMN` is safe and preserves
data. Run once per database (`DB_PATH` selects the file):

```sql
ALTER TABLE users    ADD COLUMN partner_id integer;
ALTER TABLE expenses ADD COLUMN paid_by_user_id integer;
ALTER TABLE expenses ADD COLUMN reimbursed_at text;
ALTER TABLE expenses ADD COLUMN reimbursed_by_user_id integer;
DROP TABLE IF EXISTS expense_splits;   -- if not already dropped
DROP TABLE IF EXISTS __new_expenses;   -- orphan from a failed push, if present
```

### Backfill the owner mapping

`db:seed` only populates **empty** tables, so it won't map pre-existing users. Backfill the
owner accounts by name (matches what `seed.ts` does for fresh installs):

```sql
UPDATE users SET partner_id = (SELECT id FROM partners p WHERE p.name = users.name)
  WHERE name IN (SELECT name FROM partners);
```

Owner users (Nicolás, Anastasia) get a `partner_id`; Admin and Co-host stay null.

## Caveat: a future `db:push` may re-propose an `expenses` rebuild

The manual `ADD COLUMN`s carry no FK-constraint metadata, so drizzle may still want to
rebuild `expenses` to "add" the `paid_by_user_id` / `reimbursed_by_user_id` foreign keys —
the same rebuild that fails above. It's cosmetic: the drizzle ORM doesn't enforce SQLite FKs
at runtime, so nothing breaks. If it ever needs reconciling, let drizzle rebuild the table on
its own (no concurrent column-add racing the row copy).
