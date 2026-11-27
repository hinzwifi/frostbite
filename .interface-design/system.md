# Frostbite Interface Design System

## Direction
- **Mode:** Operate (Cold-Chain Operations PWA — mobile-first touch ergonomics + dense desktop ledger)
- **Palette:** Cool frost/slate neutral ramp (`--bg`, `--surface`, `--sidebar-bg`, `--surface-subtle`), single glacier accent (`#0284c7` light / `#38bdf8` dark), semantic status colors (`--good`, `--warn`, `--danger`).
- **Typography:** `IBM Plex Sans` (400, 500, 600) for UI + `IBM Plex Mono` (`tabular-nums`) for peso figures, barcodes, batch codes, and stock counts.

## Dimensions & Spacing (4px grid)
- **Sidebar width:** `240px` (`w-60`), cooler `--sidebar-bg` surface
- **Max content width:** `1440px`
- **Mobile bottom bar:** `min-h-[56px]` + `env(safe-area-inset-bottom)`
- **Touch targets:** Minimum `44px` height on primary mobile controls and bottom-bar tabs
- **Radii:** Controls `8px` (`rounded-lg`), Cards/Tables `12px` (`rounded-xl`), Modals/Sheets `16px` (`rounded-2xl` / `rounded-t-2xl` on mobile)

## Motion & Mobile-Native Physics
- `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` (120–200ms)
- `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` (260ms mobile bottom sheets)
- Press feedback: `active:scale-[0.97]` on interactive buttons (`touch-action: manipulation`, `user-select: none`, `-webkit-tap-highlight-color: transparent`)
- Coarse pointer inputs (`@media (pointer: coarse)`): `font-size: 16px` to prevent iOS Safari focus zoom
- Zero decorative looping animations; `@media (prefers-reduced-motion: reduce)` respected globally.
