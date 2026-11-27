# Frostbite

Offline-first cold-chain frozen goods inventory, FEFO batch & expiration tracking, partner store consignment settlement, and budget-aware restock optimizer backed by self-hosted **PocketBase**.

## Features
- **Hybrid Consignment + Direct Sales:** Track main freezer stock and stock placed at partner stores; count remaining stock on visits to auto-calculate sold units, store commission cuts (e.g. ₱5/unit or `SRP − Wholesale`), and owner cash remittance.
- **FEFO Batch & Expiry Tracking:** Every restock creates an expiry-tracked batch; sales and store placements auto-deduct earliest-expiring batches first, with 30/14/7-day alerts and clearance promo price suggestions.
- **Barcodes:** Phone camera scanning (`html5-qrcode`), USB/Bluetooth keyboard-wedge scanner support, and printable Code128/QR label sheets.
- **100% Offline-First Sync:** Dexie IndexedDB + Outbox Queue + Delta Stock Movement Ledger + PocketBase Realtime sync across devices.
- **Algorithms & Analytics:** Budget-Aware Restock Optimizer, WMA + Exponential Smoothing demand forecasting (7/14/30d), Buy-Price trend alerts, Hybrid Favorability (0–100), and 5 interactive charts.

## Local Development
```bash
cp .env.example .env
# Edit VITE_POCKETBASE_URL if needed (default: http://100.78.96.84:8090)
npm install
npm run dev
```

## Docker Compose Deployment (Recommended on your Tailscale server)
```bash
docker compose up -d --build
```
This runs:
- **PocketBase** on port `8090` (persisted in `pb_data`)
- **Frostbite PWA** on port `8080`, proxying `/api/` and `/_/` to PocketBase on the same origin (zero CORS or mixed-content issues).

### Enable HTTPS over Tailscale (required for mobile camera barcode scanning & PWA install)
On your Tailscale server:
```bash
tailscale serve --bg http://127.0.0.1:8080
```
Then open `https://<your-node>.<tailnet>.ts.net` on your phone or laptop and install Frostbite as a PWA.
