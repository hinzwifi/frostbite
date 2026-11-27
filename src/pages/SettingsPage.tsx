import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, LogOut, RefreshCw, Save, Server } from 'lucide-react';
import { db } from '../lib/db';
import { exportToCsv, formatDateTime, todayIsoDate } from '../lib/format';
import { saveAppSetting } from '../lib/inventory';
import { getPocketBaseUrl, logoutOwner, setPocketBaseUrl } from '../lib/pocketbase';
import { stopRealtimeSync, useSyncStatus } from '../lib/sync';
import type {
  Batch,
  ExpiryThresholds,
  OptimizerWeights,
  PriceHistory,
  Product,
  Sale,
} from '../types/models';

interface Props {
  thresholds: ExpiryThresholds;
  weights: OptimizerWeights;
  products: Product[];
  batches: Batch[];
  sales: Sale[];
  priceHistory: PriceHistory[];
  onLogout: () => void;
}

export function SettingsPage({
  thresholds,
  weights,
  products,
  batches,
  sales,
  priceHistory,
  onLogout,
}: Props) {
  const sync = useSyncStatus();
  const outbox = useLiveQuery(() => db.outbox.orderBy('id').toArray(), []) ?? [];

  const [pbUrl, setPbUrl] = useState(getPocketBaseUrl());
  const [warn30, setWarn30] = useState(String(thresholds.warn30));
  const [warn14, setWarn14] = useState(String(thresholds.warn14));
  const [critical7, setCritical7] = useState(String(thresholds.critical7));

  const [wMargin, setWMargin] = useState(String(Math.round(weights.margin * 100)));
  const [wVelocity, setWVelocity] = useState(String(Math.round(weights.velocity * 100)));
  const [wSellThrough, setWSellThrough] = useState(String(Math.round(weights.sellThrough * 100)));
  const [wShelfLife, setWShelfLife] = useState(String(Math.round(weights.shelfLife * 100)));
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setPocketBaseUrl(pbUrl);

    await saveAppSetting('expiry_thresholds', {
      warn30: Number(warn30) || 30,
      warn14: Number(warn14) || 14,
      critical7: Number(critical7) || 7,
    });

    const sum =
      (Number(wMargin) || 0) +
      (Number(wVelocity) || 0) +
      (Number(wSellThrough) || 0) +
      (Number(wShelfLife) || 0);
    const norm = sum > 0 ? sum : 100;

    await saveAppSetting('optimizer_weights', {
      margin: (Number(wMargin) || 30) / norm,
      velocity: (Number(wVelocity) || 30) / norm,
      sellThrough: (Number(wSellThrough) || 25) / norm,
      shelfLife: (Number(wShelfLife) || 15) / norm,
    });

    setSavedMsg('Settings saved and queued for PocketBase sync.');
    setTimeout(() => setSavedMsg(null), 3000);
  };

  const handleSignOut = async () => {
    await stopRealtimeSync();
    logoutOwner();
    onLogout();
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
          Settings &amp; offline sync
        </h1>
        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
          Configure PocketBase server connection, FEFO alert thresholds, algorithm weights, and exports
        </p>
      </div>

      {/* Sync & Outbox Status */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-[var(--text-primary)]">
              Offline ledger &amp; PocketBase sync
            </h2>
            <p className="mt-0.5 font-mono-num text-xs text-[var(--text-secondary)]">
              Status: {sync.online ? 'Online' : 'Offline'} · Pending queue: {sync.pendingCount} · Last synced:{' '}
              {formatDateTime(sync.lastSyncedAt)}
            </p>
            {sync.lastError && (
              <p className="mt-1 text-xs text-[var(--danger)]">Last error: {sync.lastError}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void sync.syncNow()}
            disabled={sync.syncing || !sync.online}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${sync.syncing ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            {sync.syncing ? 'Syncing' : 'Sync now'}
          </button>
        </div>

        {outbox.length > 0 && (
          <div className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-3">
            <div className="text-xs font-medium text-[var(--warn)]">
              Queued offline mutations ({outbox.length})
            </div>
            {outbox.slice(0, 10).map((op) => (
              <div
                key={op.id}
                className="flex items-center justify-between rounded-lg bg-[var(--surface-subtle)] px-3 py-1.5 font-mono-num text-[11px]"
              >
                <span>
                  {op.action} · {op.collection}/{op.recordId}
                </span>
                <span className="text-[var(--text-muted)]">
                  {op.lastError ? op.lastError : `retries: ${op.retries}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Config Form */}
      <form
        onSubmit={handleSaveSettings}
        className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] text-xs"
      >
        <div>
          <label className="flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
            <Server className="h-3.5 w-3.5" strokeWidth={1.5} />
            PocketBase server URL
          </label>
          <input
            type="url"
            value={pbUrl}
            onChange={(e) => setPbUrl(e.target.value)}
            placeholder="http://100.78.96.84:8090"
            className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
          />
        </div>

        <div className="border-t border-[var(--border)] pt-4">
          <div className="font-medium text-[var(--text-primary)]">FEFO expiry warning thresholds (days)</div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[var(--text-secondary)]">Watch (days)</label>
              <input
                type="number"
                min="1"
                value={warn30}
                onChange={(e) => setWarn30(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
              />
            </div>
            <div>
              <label className="block text-[var(--text-secondary)]">Promo warning (days)</label>
              <input
                type="number"
                min="1"
                value={warn14}
                onChange={(e) => setWarn14(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
              />
            </div>
            <div>
              <label className="block text-[var(--text-secondary)]">Critical clearance (days)</label>
              <input
                type="number"
                min="1"
                value={critical7}
                onChange={(e) => setCritical7(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--border)] pt-4">
          <div className="font-medium text-[var(--text-primary)]">
            Favorability &amp; optimizer weights (%)
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-[var(--text-secondary)]">Margin</label>
              <input
                type="number"
                min="0"
                max="100"
                value={wMargin}
                onChange={(e) => setWMargin(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
              />
            </div>
            <div>
              <label className="block text-[var(--text-secondary)]">Velocity</label>
              <input
                type="number"
                min="0"
                max="100"
                value={wVelocity}
                onChange={(e) => setWVelocity(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
              />
            </div>
            <div>
              <label className="block text-[var(--text-secondary)]">Sell-through</label>
              <input
                type="number"
                min="0"
                max="100"
                value={wSellThrough}
                onChange={(e) => setWSellThrough(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
              />
            </div>
            <div>
              <label className="block text-[var(--text-secondary)]">Shelf life</label>
              <input
                type="number"
                min="0"
                max="100"
                value={wShelfLife}
                onChange={(e) => setWShelfLife(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
          <span className="text-xs text-[var(--good)]">{savedMsg ?? ''}</span>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
            Save settings
          </button>
        </div>
      </form>

      {/* CSV Exports */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">Data exports (CSV)</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              exportToCsv(
                `frostbite-products-${todayIsoDate()}.csv`,
                products as unknown as Record<string, unknown>[]
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface-subtle)]"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            Products ({products.length})
          </button>
          <button
            type="button"
            onClick={() =>
              exportToCsv(
                `frostbite-batches-${todayIsoDate()}.csv`,
                batches as unknown as Record<string, unknown>[]
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface-subtle)]"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            FEFO batches ({batches.length})
          </button>
          <button
            type="button"
            onClick={() =>
              exportToCsv(
                `frostbite-price-history-${todayIsoDate()}.csv`,
                priceHistory as unknown as Record<string, unknown>[]
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface-subtle)]"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            Price history ({priceHistory.length})
          </button>
          <button
            type="button"
            onClick={() =>
              exportToCsv(
                `frostbite-sales-${todayIsoDate()}.csv`,
                sales as unknown as Record<string, unknown>[]
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface-subtle)]"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            Sales &amp; settlements ({sales.length})
          </button>
        </div>
      </div>

      {/* Sign out */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-4 py-2 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-subtle)]"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
          Sign out
        </button>
      </div>
    </div>
  );
}
