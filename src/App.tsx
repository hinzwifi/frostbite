import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Calculator,
  LayoutDashboard,
  Moon,
  Package,
  RefreshCw,
  Settings,
  ShoppingCart,
  Snowflake,
  Store as StoreIcon,
  Sun,
} from 'lucide-react';
import { LoginScreen } from './components/LoginScreen';
import { SetupWizard } from './components/SetupWizard';
import {
  computeAllProductMetrics,
  DEFAULT_EXPIRY_THRESHOLDS,
  DEFAULT_OPTIMIZER_WEIGHTS,
} from './lib/algorithms';
import { db } from './lib/db';
import { checkBootstrapStatus, isAuthenticated } from './lib/pocketbase';
import {
  initSyncListeners,
  startRealtimeSync,
  triggerSync,
  useSyncStatus,
} from './lib/sync';
import { CatalogPage } from './pages/CatalogPage';
import { DashboardPage } from './pages/DashboardPage';
import { OptimizerPage } from './pages/OptimizerPage';
import { PosPage } from './pages/PosPage';
import { SettingsPage } from './pages/SettingsPage';
import { StoresPage } from './pages/StoresPage';
import type { ExpiryThresholds, OptimizerWeights } from './types/models';

type NavTab = 'dashboard' | 'catalog' | 'stores' | 'pos' | 'optimizer' | 'settings';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'catalog', label: 'Catalog & FEFO', icon: Package },
  { id: 'stores', label: 'Partner stores', icon: StoreIcon },
  { id: 'pos', label: 'Direct POS', icon: ShoppingCart },
  { id: 'optimizer', label: 'Restock optimizer', icon: Calculator },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function getInitialDark(): boolean {
  const saved = localStorage.getItem('frostbite_theme');
  if (saved === 'dark') return true;
  if (saved === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function App() {
  const [authed, setAuthed] = useState<boolean>(isAuthenticated());
  const [checkingSetup, setCheckingSetup] = useState<boolean>(() => !isAuthenticated());
  const [needsSetup, setNeedsSetup] = useState<boolean>(false);
  const [authView, setAuthView] = useState<'setup' | 'login'>('login');
  const [bootstrapName, setBootstrapName] = useState<string>('Frostbite');
  const [tab, setTab] = useState<NavTab>('dashboard');
  const [dark, setDark] = useState<boolean>(getInitialDark);

  const sync = useSyncStatus();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('frostbite_theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const cleanup = initSyncListeners();
    return cleanup;
  }, []);

  useEffect(() => {
    if (authed) {
      setCheckingSetup(false);
      void triggerSync();
      void startRealtimeSync();
      return;
    }

    let cancelled = false;
    setCheckingSetup(true);
    void checkBootstrapStatus().then((status) => {
      if (cancelled) return;
      setBootstrapName(status.businessName || 'Frostbite');
      const shouldSetup = status.reachable && !status.initialized;
      setNeedsSetup(shouldSetup);
      setAuthView(shouldSetup ? 'setup' : 'login');
      setCheckingSetup(false);
    });
    return () => {
      cancelled = true;
    };
  }, [authed]);

  // Live IndexedDB queries (0ms offline-first reactivity, zero static data)
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const priceHistory = useLiveQuery(() => db.price_history.toArray(), []) ?? [];
  const batches = useLiveQuery(() => db.batches.toArray(), []) ?? [];
  const stores = useLiveQuery(() => db.stores.toArray(), []) ?? [];
  const overrides = useLiveQuery(() => db.store_price_overrides.toArray(), []) ?? [];
  const sales = useLiveQuery(() => db.sales.toArray(), []) ?? [];
  const saleItems = useLiveQuery(() => db.sale_items.toArray(), []) ?? [];
  const movements = useLiveQuery(() => db.stock_movements.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.app_settings.toArray(), []) ?? [];

  const businessName = useMemo(() => {
    const profile = settings.find((s) => s.key === 'business_profile')?.value as
      | { businessName?: string }
      | undefined;
    return profile?.businessName?.trim() || bootstrapName || 'Frostbite';
  }, [settings, bootstrapName]);

  const thresholds: ExpiryThresholds = useMemo(() => {
    const found = settings.find((s) => s.key === 'expiry_thresholds')?.value as
      | Partial<ExpiryThresholds>
      | undefined;
    return {
      warn30: Number(found?.warn30) || DEFAULT_EXPIRY_THRESHOLDS.warn30,
      warn14: Number(found?.warn14) || DEFAULT_EXPIRY_THRESHOLDS.warn14,
      critical7: Number(found?.critical7) || DEFAULT_EXPIRY_THRESHOLDS.critical7,
    };
  }, [settings]);

  const weights: OptimizerWeights = useMemo(() => {
    const found = settings.find((s) => s.key === 'optimizer_weights')?.value as
      | Partial<OptimizerWeights>
      | undefined;
    return {
      margin: Number(found?.margin) || DEFAULT_OPTIMIZER_WEIGHTS.margin,
      velocity: Number(found?.velocity) || DEFAULT_OPTIMIZER_WEIGHTS.velocity,
      sellThrough: Number(found?.sellThrough) || DEFAULT_OPTIMIZER_WEIGHTS.sellThrough,
      shelfLife: Number(found?.shelfLife) || DEFAULT_OPTIMIZER_WEIGHTS.shelfLife,
    };
  }, [settings]);

  const metrics = useMemo(
    () =>
      computeAllProductMetrics({
        products,
        batches,
        sales,
        saleItems,
        priceHistory,
        movements,
        weights,
      }),
    [products, batches, sales, saleItems, priceHistory, movements, weights]
  );

  if (!authed) {
    if (checkingSetup) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-xs text-[var(--text-secondary)]">
          Checking PocketBase startup status…
        </div>
      );
    }

    if (authView === 'setup') {
      return (
        <SetupWizard
          dark={dark}
          onToggleDark={() => setDark((d) => !d)}
          onComplete={(name) => {
            setBootstrapName(name);
            setNeedsSetup(false);
            setAuthed(true);
          }}
          onSwitchToLogin={() => setAuthView('login')}
        />
      );
    }

    return (
      <LoginScreen
        businessName={businessName}
        dark={dark}
        canRunSetup={needsSetup}
        onToggleDark={() => setDark((d) => !d)}
        onSuccess={() => setAuthed(true)}
        onSwitchToSetup={() => setAuthView('setup')}
      />
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      {/* Desktop Sidebar — second neutral layer, 4px grid, aligned icons */}
      <aside className="no-print hidden w-60 shrink-0 flex-col justify-between border-r border-[var(--border)] bg-[var(--sidebar-bg)] p-4 md:flex">
        <div>
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
              <Snowflake className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <span className="truncate text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
              {businessName}
            </span>
          </div>

          <nav className="mt-6 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ${
                    active
                      ? 'bg-[var(--surface-subtle)] font-medium text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                    }`}
                    strokeWidth={1.5}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Signature detail: Cold-Chain Sync & Offline Ledger Pill + Theme */}
        <div className="space-y-2 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={() => void sync.syncNow()}
            className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-xs hover:bg-[var(--surface-subtle)] transition-colors"
            title="Click to sync with PocketBase"
          >
            <span className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  !sync.online
                    ? 'bg-[var(--warn)]'
                    : sync.pendingCount > 0
                      ? 'bg-[var(--warn)]'
                      : 'bg-[var(--good)]'
                }`}
              />
              <span className="text-[var(--text-secondary)]">
                {!sync.online
                  ? 'Offline ledger'
                  : sync.pendingCount > 0
                    ? `${sync.pendingCount} queued`
                    : 'Synced'}
              </span>
            </span>
            <RefreshCw
              className={`h-3.5 w-3.5 text-[var(--text-muted)] ${sync.syncing ? 'animate-spin' : ''}`}
              strokeWidth={1.5}
            />
          </button>

          <button
            type="button"
            onClick={() => setDark((d) => !d)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] transition-colors"
          >
            {dark ? <Sun className="h-4 w-4" strokeWidth={1.5} /> : <Moon className="h-4 w-4" strokeWidth={1.5} />}
            <span>{dark ? 'Light mode' : 'Dark mode'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile Top Bar */}
        <header className="no-print flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
              <Snowflake className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <span className="truncate text-sm font-semibold">{businessName}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void sync.syncNow()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  !sync.online || sync.pendingCount > 0 ? 'bg-[var(--warn)]' : 'bg-[var(--good)]'
                }`}
              />
              <span className="font-mono-num text-[11px]">
                {!sync.online ? 'Offline' : sync.pendingCount > 0 ? `${sync.pendingCount}` : 'Synced'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              className="rounded-lg p-1.5 text-[var(--text-secondary)]"
              aria-label="Toggle theme"
            >
              {dark ? <Sun className="h-4 w-4" strokeWidth={1.5} /> : <Moon className="h-4 w-4" strokeWidth={1.5} />}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 p-5 pb-24 md:p-7 md:pb-8">
          {tab === 'dashboard' && (
            <DashboardPage
              products={products}
              metrics={metrics}
              batches={batches}
              stores={stores}
              sales={sales}
              saleItems={saleItems}
              thresholds={thresholds}
              onNavigate={(next) => setTab(next)}
            />
          )}
          {tab === 'catalog' && (
            <CatalogPage
              products={products}
              metrics={metrics}
              batches={batches}
              priceHistory={priceHistory}
              sales={sales}
              saleItems={saleItems}
              stores={stores}
              thresholds={thresholds}
            />
          )}
          {tab === 'stores' && (
            <StoresPage
              stores={stores}
              products={products}
              batches={batches}
              overrides={overrides}
            />
          )}
          {tab === 'pos' && (
            <PosPage
              products={products}
              batches={batches}
              stores={stores}
              overrides={overrides}
              sales={sales}
              saleItems={saleItems}
            />
          )}
          {tab === 'optimizer' && <OptimizerPage metrics={metrics} defaultWeights={weights} />}
          {tab === 'settings' && (
            <SettingsPage
              thresholds={thresholds}
              weights={weights}
              products={products}
              batches={batches}
              sales={sales}
              priceHistory={priceHistory}
              onLogout={() => setAuthed(false)}
            />
          )}
        </main>

        {/* Mobile Bottom Navigation for one-handed scanning & store visits */}
        <nav className="no-print fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-[var(--border)] bg-[var(--surface)] px-1 py-1.5 md:hidden">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] ${
                  active ? 'font-medium text-[var(--accent)]' : 'text-[var(--text-muted)]'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
                <span>{item.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export default App;
