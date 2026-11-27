# Frostbite — Design System (`DESIGN.md`)

## Surface Mode
**Operate** — task-driven cold-chain operations tool where scanability, numerical precision, speed, and zero-hesitation affordances outrank decorative expression.

## Visual World
**Cold-storage manifest & weigh-station instrument.** Cool slate-tinted neutrals with a second cooler neutral layer for the sidebar and operational headers, crisp hairline dividers, and a single glacier-blue (`#0284c7` / `#38bdf8` in dark) accent reserved strictly for primary actions, active navigation, and lead chart series.

## Typography
- **Interface & headings:** `IBM Plex Sans` (weights `400`, `500`, `600`) — engineered, legible at dense table sizes, zero display-font ornament.
- **Data, barcodes, receipts, currency:** `IBM Plex Mono` (`font-variant-numeric: tabular-nums`) so every peso figure, batch code, and stock count aligns vertically to the pixel.
- **Scale:** Fixed rem scale (`0.75rem` meta, `0.875rem` body/table, `1rem` section titles, `1.25rem` page title, `1.5rem` ledger readouts). Sentence case everywhere; no uppercase tracked kickers.

## Color Tokens
- **Light ground / surface / subtle:** `#f6f8fa` / `#ffffff` / `#eef2f6`
- **Dark ground / surface / subtle:** `#0d1117` / `#151b23` / `#1c242f`
- **Primary accent:** `#0284c7` (light) / `#38bdf8` (dark)
- **Semantic states:** Good `#047857` (`#34d399` dark), Warn `#b45309` (`#fbbf24` dark), Danger `#b91c1c` (`#f87171` dark).

## Component & Layout Rules
- **Unified operational ledger strips** instead of repetitive identical stat cards.
- **No one-sided colored border bars** — use leading semantic status dots and clear labels for FEFO expiry urgency.
- **Themed browser surfaces:** Custom `::selection`, `caret-color`, `text-underline-offset`, and hairline scrollbars matching the active light/dark palette.
- **Motion:** 150–200ms state transitions (`transition-colors`, `transition-opacity`), zero decorative loops.
