# Frostbite — Product Context

## What it is
Frostbite is an offline-first cold-chain operations web application (PWA) for a solo frozen-goods distributor in the Philippines. It manages main freezer inventory, FEFO (First Expired, First Out) batches, partner-store consignment placement and remittance settlements, direct retail/wholesale POS, barcode scanning and label printing, and budget-aware restock optimization.

## Who uses it
- **Primary user:** Solo business owner operating from a laptop (planning, restock optimization, analytics, printing) and an Android phone (on-site partner store visits, barcode scanning, receiving deliveries, direct POS).
- **Usage environment:** Wet markets, delivery routes with spotty or zero cellular signal, bright outdoor daylight, and dim cold-storage rooms (requiring both crisp light mode and clean dark mode).

## Platform
- Web PWA (desktop + mobile responsive), self-hosted via Docker Compose alongside PocketBase (`http://100.78.96.84:8090`) behind Tailscale HTTPS (`tailscale serve`).
- Local-first persistence via Dexie (IndexedDB) with an idempotent outbox queue and PocketBase Realtime multi-device sync.

## Core workflows
1. **First-time admin bootstrap:** Auto-detects an uninitialized PocketBase instance and creates the first admin account + business/FEFO defaults.
2. **Catalog & FEFO receiving:** Fixed units (`kg`, `pack`, `pc`, `box`), 3 core prices (`buy_price`, `wholesale_price`, `srp_price`), automatic price history logging, barcode scan/generation, and FEFO expiry batch tracking with 30/14/7-day alerts and clearance price suggestions.
3. **Partner store consignment:** Place FEFO batches into partner stores (e.g. sari-sari stores), count remaining stock on visits to auto-calculate sold quantity, store commission cut (e.g. ₱5/unit or `SRP − Wholesale`), cash remittance due, and printable settlement receipts.
4. **Direct POS:** Fast retail/wholesale checkout with camera + USB/Bluetooth barcode scanning and per-client custom wholesale price overrides.
5. **Restock optimizer & analytics:** Enter available capital in PHP (`₱`) to allocate optimal restock quantities using margin, WMA+SES demand forecasting, sell-through, and spoilage risk.

## Non-negotiable constraints
- Zero static or hardcoded business data — every product, store, batch, price point, and chart comes live from PocketBase / IndexedDB.
- Currency formatted in Philippine Peso (`₱`) with strict tabular numerals (`tabular-nums`).
- Must work 100% offline for scanning, sales, receiving, and store visits, syncing automatically when connectivity returns.
