---
name: Precision Ledger
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45474c'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#75777d'
  outline-variant: '#c5c6cd'
  surface-tint: '#545f73'
  primary: '#091426'
  on-primary: '#ffffff'
  primary-container: '#1e293b'
  on-primary-container: '#8590a6'
  inverse-primary: '#bcc7de'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#00190e'
  on-tertiary: '#ffffff'
  tertiary-container: '#00301e'
  on-tertiary-container: '#00a472'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e3fb'
  primary-fixed-dim: '#bcc7de'
  on-primary-fixed: '#111c2d'
  on-primary-fixed-variant: '#3c475a'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
  data-mono:
    fontFamily: monospace
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
spacing:
  unit: 4px
  gutter: 12px
  margin-mobile: 16px
  margin-desktop: 24px
  table-cell-padding: 8px 12px
---

## Brand & Style
The design system serves a small, trusted circle managing the finances of a co-owned rental property — not an institution. Its job is **warm precision**: earn trust through accuracy and calm rather than coldness. The personality is *precise · trustworthy · human*. It is data-dense and disciplined, but it should read as a clear-headed colleague, never a compliance terminal.

The visual style is **Functional Minimalism** with a data-first hierarchy: subtle tonal shifts and considered detail guide the eye instead of decoration. Restraint here is in service of the people, not austerity for its own sake — the warmth is carried by clarity, plain language, and care, not by color or ornament. The feeling to evoke is *quiet confidence*: the numbers are handled, accurate, and never surprising.

## Colors
The palette is grounded in Deep Navy (#1e293b), giving a calm, grounded sense of trust and stability. Slate (#64748b) acts as the secondary utility color, used for supporting UI elements, inactive states, and secondary metadata.

Emerald is reserved strictly for positive financial indicators and successful status completions; for text and figures use a darkened Emerald (#047857) so it clears 4.5:1. For negative indicators use Rose (#be123c) so the sign reads at a glance. Critically, **never rely on color alone** to convey a signed value — pair it with the minus sign and right-aligned columns so it survives color-blindness and greyscale. The background is a soft, low-fatigue off-white slate (#f7f9fb) chosen to rest the eye over long entry sessions, not to feel sterile.

## Typography
This design system utilizes **Inter** across all roles to leverage its exceptional legibility in small sizes and high-density environments. 

- **Numerical Data:** For tabular data and financial ledgers, utilize a tabular-lining OpenType feature to ensure digits align vertically.
- **Hierarchy:** Use font weight (SemiBold 600) rather than large scale leaps to differentiate sections, maintaining a compact vertical footprint.
- **Labels:** Small, uppercase labels with slightly increased tracking are used for table headers and form section titles to provide clear categorization without occupying significant real estate.

## Layout & Spacing
The layout is an **app shell**: a persistent navy sidebar for navigation plus a centered content column (max ~64rem) so dense tables stay readable without sprawling on wide screens. Desktop-first, since this is where the real work happens, but fully responsive.

- **Structure:** Sidebar + content column; sections are outline-defined panels stacked with a consistent rhythm rather than a rigid 12-column grid.
- **Density:** We employ a tight 4px base spacing unit. Internal padding stays compact for "at-a-glance" reading, but never so tight it feels cramped — breathing room is part of the warmth.
- **Table Structure:** Tables are the primary vehicle for information. Use a "condensed" vertical rhythm with 8px of vertical padding per row; wide tables scroll horizontally within their panel rather than break the layout.
- **Breakpoints:** Under ~880px the sidebar collapses to a stacked top bar — brand and account actions on one row, a full-width horizontally-scrollable nav strip beneath — so every destination stays reachable with no JavaScript drawer.

## Elevation & Depth
In alignment with the professional and precise aesthetic, elevation is achieved through **Low-Contrast Outlines** and subtle tonal layering rather than shadows.

- **Surfaces:** Use a 1px border (#e2e8f0) for all container definitions. 
- **Tiers:** Background is Slate-50, primary containers are White (#ffffff), and inset elements (like search bars) use Slate-100.
- **Interactive Depth:** On hover, use a subtle background color shift (e.g., White to Slate-50). For active/selected list and nav items use a filled background, **not** a colored left-border stripe — side-stripes read as a generic-admin-template tell and are avoided here. Drop shadows are avoided entirely except on temporary overlays (tooltips, dropdown menus), which use a sharp 4px blur at 10% opacity.

## Shapes
The shape language is **Sharp**: all UI elements (buttons, inputs, panels) use a 2px corner radius. The near-square corners signal precision and keep the interface feeling exact rather than playful. Large rounded corners are avoided — they waste space in dense grids and pull toward consumer-app softness, which isn't this product's voice. (Sharpness is the precision half of "warm precision"; the warmth is carried by language and clarity, not by rounding the corners.)

## Components
- **Buttons:** Primary buttons are Solid Navy (#1e293b) with White text. Secondary buttons use a Slate-200 border with Navy text. State changes (hover/active) should be represented by subtle darkening of the background.
- **Input Fields:** Use 1px Slate-300 borders. Focus states transition the border to Navy with a 1px inner glow. Labels are always "Top-Aligned Left" for maximum scanability in forms.
- **Data Tables:** Zebra-striping is used (alternating White and Slate-50) to assist horizontal eye tracking. Headers are Slate-100 with Bold 11px uppercase labels.
- **Status Chips:** Small, rectangular chips with 2px radius. Positive (Emerald), Negative (Rose), Pending (Amber). Use low-saturation backgrounds with high-saturation text for readability.
- **Ledger Rows:** Include a "hover-action" state where utility buttons (edit/delete) only appear on row hover to reduce visual noise in the default view.