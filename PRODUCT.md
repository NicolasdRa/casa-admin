# Product

## Register

product

## Users

A small, trusted circle around one co-owned rental property (Casa Bosque, Argentina) — not the general public.

- **Owner(s) abroad** (`superadmin`) — think in EUR, review finances remotely, care about the net result, partner settlements, and that the numbers are trustworthy. Often on desktop, occasionally checking from a phone.
- **Local manager / admin** (`admin`) — on the ground in Argentina, works in ARS, enters bookings and expenses, attaches receipts, reconciles the cash account (caja). The heaviest day-to-day user; values fast, low-friction entry.
- **Co-host** (`user`) — limited helper. Can record activity but net partnership results are hidden from them. The UI must honor that boundary without making them feel walled off.

Shared context: this replaces an Excel workflow. Users already know their domain; they need structure, guardrails, and speed — not hand-holding. Money spans two currencies (EUR ⇄ ARS via BNA rates), so trust in the conversion is part of the job.

## Product Purpose

Casa Bosque administers the finances of a co-owned rental property in a single, bilingual (ES default / EN) source of truth — replacing a fragile spreadsheet. It records bookings and expenses with an **immutable FX snapshot** at entry, splits results between partners so no cent is created or lost, tracks a shared cash account, and produces per-year P&L, multi-year balances, and per-partner statements with CSV/print export.

Success looks like: the owner abroad trusts the net figure without re-checking a spreadsheet; the local manager enters a day's activity in seconds; partner settlements are unambiguous; and nobody opens Excel again.

## Brand Personality

**Warm precision.** This is a family partnership's tool, not a bank's terminal — so it earns trust through accuracy and calm, not coldness.

- Three words: **precise · trustworthy · human**.
- Voice: plain, direct, bilingual-native. Labels and messages read like a clear-headed colleague, not a compliance system or a chatty consumer app. Errors explain what to do next.
- Emotional goal: quiet confidence. The user should feel the numbers are *handled* — accurate, reversible where it matters, never surprising.
- The visual system (see DESIGN.md) is deliberately restrained and data-first; warmth comes from clarity, human copy, and considered detail rather than decoration or color.

## Anti-references

The user explicitly rejected all four of these — the design must avoid each:

- **Generic admin template.** No off-the-shelf Material/Bootstrap dashboard look: purple sidebars, default component-library chrome, the "every internal tool" feel. This should read as built *for* Casa Bosque.
- **Playful consumer SaaS.** No big gradients, rounded blobs, mascots, emoji-as-UI, or marketing-y dashboard theatrics. It handles real money.
- **Over-animated.** No motion for its own sake, sliding/bouncing panels, or transitions that sit between the user and their data. Motion is functional and quick or absent.
- **Bare spreadsheet.** It must feel more considered than the Excel it replaces — structured, guard-railed, legible — not just grey grids.

The positive space between these: a calm, custom-feeling, data-dense instrument that respects both the money and the people.

## Design Principles

1. **Accuracy is the feature.** The whole reason this exists is correct money and FX. The UI must make correctness legible (show the snapshot rate/date, splits that visibly sum, signed results) and make the wrong entry hard to make. Never let presentation imply a number that isn't real.
2. **Replace the spreadsheet, don't imitate it.** Keep Excel's at-a-glance density and fast keyboard entry, but add the structure, validation, and guardrails it never had.
3. **Warm, not cold; calm, not loud.** Trust through clarity and plain human language, not institutional sternness or consumer flourish. Copy and empty states sound like a helpful colleague.
4. **Respect the roles.** Co-hosts see less by design (net hidden); the interface honors that trust boundary quietly, without friction or shaming.
5. **Bilingual as a baseline, not a feature.** ES and EN are equal first-class; nothing is English-only, and layouts survive the longer of the two strings.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**:

- Text contrast ≥ 4.5:1 (≥ 3:1 for large/bold); placeholder text held to the same bar, not faint grey.
- Visible focus indication on every interactive element; full keyboard operability (the app is entry-heavy).
- `prefers-reduced-motion` honored — motion is already minimal, so the reduced path is instant/crossfade.
- Bilingual labels and messages (ES/EN); never assume English.
- Tabular figures and right-aligned money columns so amounts are scannable and comparable.
- Headroom for older/low-vision users in mind even though AA is the committed bar — avoid relying on color alone to convey signed/negative values (pair with sign and alignment).
