# Data Import Strategy — Casa Bosque Rental Administration

**Companion to:** Casa Bosque - Rental Administration PRD (v0.2)
**Source file:** `Administración alquileres Casa Bosque.xlsx`
**Target:** SolidStart + SQLite data model (PRD §5)
**Audience:** implementing agents
**Version:** 0.1

---

## 1. Objectives & Principles

The import is a **one-time historical migration** (2023–2026) plus a re-runnable process during development. It must:

1. **Preserve original facts, recompute aggregates.** Import only *source-of-truth* rows (individual bookings, expenses, cash movements, tasks). Do **not** import totals, subtotals, or the Balance sheet results — those are recomputed by the app from the imported rows, and importing them would create double-counting and drift.
2. **Snapshot FX and commission.** Every imported booking/expense carries the original currency, amount, the FX rate used, and the rate date exactly as in the sheet (PRD FX-4, BK-7). Never re-derive a rate from today's data.
3. **Be idempotent and reversible.** Re-running the import must not duplicate rows. Use a deterministic natural key per record and a dedicated import run that can be rolled back.
4. **Stage, validate, then load.** Parse into a staging layer, run reconciliation against the workbook's own subtotals, and only then write to the live tables.
5. **Fail loud on ambiguity.** Any row that cannot be mapped confidently (missing date, unparseable amount, unknown partner/category) goes to a **rejects** report for human review rather than being silently dropped or guessed.

---

## 2. Source Inventory & Classification

| Sheet | Contains | Source of truth? | Maps to |
|---|---|---|---|
| `Gastos 2023/2024/2025/2026` | Itemised expenses, sectioned by category, per-partner columns, per-row FX | **Yes** (rows) | `Expense`, `ExpenseSplit`, `FxRate` |
| `Alquileres 20232026` | Itemised bookings (4 side-by-side year blocks) | **Yes** (rows) | `Booking`, `FxRate` |
| `Balance` → Caja ledger & per-partner statements | Cash contributions, withdrawals, commission settlements | **Yes** (ledger rows) | `CashEntry`, `CommissionSettlement` |
| `Balance` → year results table | Income/expense/result per year | **No** (derived) | Recomputed; used only for reconciliation |
| `Tareas mantenimiento pre-tempor` | Maintenance tasks (3 side-by-side year blocks) | **Yes** (rows) | `MaintenanceTask` |
| Subtotal / Total rows in any sheet | Sums | **No** | Used only for reconciliation checks |

**Reference data to seed first:** `Partner` (Nicolás, Anastasia), `Category` (operativos, equipamiento, mantenimiento, impuestos, servicios), and the co-host. These must exist before fact rows are loaded.

---

## 3. Sheet-by-Sheet Mapping

### 3.1 Gastos {year} → Expense + ExpenseSplit + FxRate

**Layout discovered:** each sheet is a stack of **category sections**. A section begins with a header row where `C` = the category name (`Gastos operativos`, `Gastos equipamiento`, `Gastos mantenimiento`, `Impuestos & tasas`, `Servicios`), followed by a column-header row (`FECHA | Proveedor/impuesto/servicio | detalle | ARS | EUR | ARS | EUR | € prom | compra | venta`), then data rows, then a `Total / subtotales` row.

Columns:

| Col | Meaning |
|---|---|
| B | FECHA (date; sometimes an Excel serial; may be blank → carry forward) |
| C | Proveedor / impuesto / servicio (supplier name) |
| D | detalle (description) |
| E / F | **Nicolás** — amount in ARS / EUR |
| G / H | **Anastasia** — amount in ARS / EUR |
| J / K / L | FX: € prom (average), compra (buy), venta (sell) |

**Parsing algorithm:**

1. Walk rows top to bottom; track the **current category** from the most recent section header (`C` matches one of the five category labels and `E`='Nicolás'/`G`='Anastasia' on that or the next row).
2. Skip the column-header rows and the `Total`/`subtotales` rows (detect `B`/`D` containing "Total"/"subtotales").
3. For each data row, determine the **partner** by which column pair is populated: E/F → Nicolás, G/H → Anastasia. A row may populate both pairs → emit **one Expense with two `ExpenseSplit` rows**; otherwise a single split (100%).
4. Original currency is **ARS** (the E/G value); `amount_eur` is the sheet's already-computed EUR (F/H). `fx_rate` = `J` (€ prom); if J missing, fall back to mean(K,L) or flag. `fx_rate_date` = the row date.
5. `category` ← current section. `supplier` ← C (upsert into `Supplier`). `detail` ← D.

**Edge cases:** rows with only J (no K/L); a handful of rows where the date is an Excel serial integer (convert); blank dates inherited from the row above (forward-fill within a section); the `Impuestos`/`Servicios` sections are frequently 100% Anastasia.

### 3.2 Alquileres 20232026 → Booking + FxRate

**Layout:** four **side-by-side year blocks** in one sheet — 2026 (cols A–F), 2025 (H–M), 2024 (O–T), 2023 (W–AB). Each block: `#`, `date`, `Huésped`, `USD`, `€`, `comisión 10% €`. Blocks 2024 and 2023 include a USD column; 2026/2025 are EUR-only.

**Parsing algorithm:**

1. **Unpivot** each year block into rows with a `year` tag; stop at the per-year `Subtotales` row (≈row 22). Ignore the expense-summary block below it (rows ~25–38) — those are recomputed.
2. Map: `date`, `guest` (Huésped), `amount`/`currency` (EUR; USD stored as `legacy_usd` reference only), `commission_eur` (the 10% column), `commission_rate` = 0.10 snapshot.
3. FX snapshot: 2024/2023 rows carry USD→€; for the new model treat **EUR as the entered currency**. Where a row is ARS-derived it is not present here (income is in €/USD), so `fx_rate`/`fx_rate_date` may be null for EUR-native bookings.
4. **Special types:** detect `type` from the guest text — "cancelación" → `cancellation` (commission 0), "damage reinbursement"/"reembolso" → `reimbursement`. These exist in the data (e.g. "Ana (cancelación)", "Anita Martingano - damage reinbursement").

### 3.3 Balance → CashEntry + CommissionSettlement

The Balance sheet's **Caja** ledger (fecha, concepto, monto, running balance) and the **per-partner statements** (Anastasia / Nicolás: contributions, withdrawals such as "retiro pasaje", "retiro saldo cuota alimentaria", subtotals) are real movements.

1. Import each ledger line as a `CashEntry` (`type` = contribution / withdrawal / allocation inferred from sign and concept).
2. Import commission payouts (if present in the statements) as `CommissionSettlement`.
3. **Do not** import the year results table (Ingresos/Gastos/Resultado per year) — recompute and use it only in reconciliation (§5).

### 3.4 Tareas mantenimiento → MaintenanceTask

**Layout:** three side-by-side year blocks (2025 in A/B, 2024 in G/H, 2023 in L/M), each `date | description`; the 2025 block has a `pendientes` sub-list.

1. Unpivot each block to `MaintenanceTask` rows with `season`/`year`, `date` (where present), `description`.
2. Items under `pendientes` → `status = pending`; all others → `status = done`.

---

## 4. Cross-cutting Transformations

- **Dates:** handle three forms — native datetimes, Excel serial integers (convert via the 1900 date system), and blank cells (**forward-fill** from the previous row within the same section/block). Reject a row only if no date can be established and none can be inherited.
- **Currency detection:** Gastos = ARS source; Alquileres = EUR (USD legacy reference). Never infer currency from magnitude.
- **FX snapshot:** copy `fx_rate` (€ prom) and `fx_rate_date` verbatim; additionally upsert a `FxRate(date, compra, venta, average)` row so the rate table is back-filled from history.
- **Partner mapping:** column position → partner id (E/F=Nicolás, G/H=Anastasia). Maintain a small config map so it is easy to adjust.
- **Amounts:** strip thousands separators; keep full precision in staging; round only for display. Store both `amount` (original) and `amount_eur`/`amount_ars`.
- **Idempotency key:** deterministic hash of `(sheet, year, source_row_index, date, supplier|guest, amount)` per record, stored as `import_key`; upserts match on it.
- **Provenance:** every imported row stores `source_sheet` and `source_row` for traceability and re-reconciliation.

---

## 5. Validation & Reconciliation

The workbook conveniently contains its own subtotals — use them as an oracle.

1. **Per-section subtotals (Gastos):** sum of imported EUR per category per year must equal the sheet's `Total/subtotales` row (within a small tolerance, e.g. ±0.05 € for rounding).
2. **Per-partner totals (Gastos):** imported `ExpenseSplit` EUR per partner must match the `Total Gastos por socio` row.
3. **Bookings (Alquileres):** sum of imported EUR per year must match the per-year `Subtotales`; commissions must match the 10% column total.
4. **Year results (Balance):** recomputed Income − Expenses − Commission per year must reconcile to the Balance sheet's `Resultado` column. Differences are surfaced, not auto-corrected.
5. **Counts:** row counts in vs. rows loaded vs. rejects must balance.
6. **Rejects report:** every unmapped/ambiguous row listed with reason.

Reconciliation runs against the **staging** layer; the load to live tables is gated on it passing (or on explicit human sign-off of known discrepancies).

---

## 6. Recommended Technical Approach

- **Parser:** a standalone script (Python + `openpyxl`, or Node + `exceljs`) that reads the workbook **with `data_only=True`** so formula cells yield their last-computed values (essential — the EUR and totals are formulas).
- **Staging:** write parsed records to intermediate CSV/JSON (or `staging_*` SQLite tables) — human-inspectable, diff-able, re-runnable.
- **Mapping config:** externalise the things likely to change — partner column map, category label list, special-type keywords (`cancelación`, `reembolso`) — so non-code tweaks are easy.
- **Loader:** idempotent upserts into the live schema keyed on `import_key`, wrapped in a single transaction per sheet, tagged with an `import_run_id` for rollback.
- **Dry-run mode:** parse + validate + produce reconciliation and rejects reports **without** writing live data.

Suggested run order: seed reference data → FxRate back-fill → Expenses (+splits) → Bookings → CashEntries/Settlements → MaintenanceTasks → reconcile → sign-off → load.

---

## 7. Known Data-Quality Issues to Expect

- Some expense rows have `€ prom` but no `compra`/`venta`.
- A few dates are stored as Excel serials or are blank (need conversion / forward-fill).
- Free-text supplier names vary in spelling/casing → upsert with normalisation; consider a manual alias map.
- 2023/2024 bookings carry USD that is being dropped operationally — keep as `legacy_usd` reference, don't convert.
- Cancellations and damage reimbursements are encoded in the guest text, not a flag.
- Maintenance tasks for some years lack dates (only descriptions).

---

## 8. Open Questions

1. **Caja semantics:** confirm the sign convention and concept→type mapping for cash entries (which concepts are contributions vs. withdrawals vs. result allocations).
2. **Commission settlements:** are co-host commission payouts recorded anywhere in the workbook, or do they start empty in the new system?
3. **Booking currency:** confirm 2026/2025 bookings are genuinely EUR-native (no FX snapshot needed) vs. ARS-converted.
4. **Supplier normalisation:** is a manual alias/cleanup pass acceptable for inconsistent supplier names?
5. **Tolerance:** acceptable reconciliation tolerance for rounding differences (proposed ±0.05 €).