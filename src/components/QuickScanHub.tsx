import { useMemo, useState } from 'react';
import {
  Camera,
  Grid2x2,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
} from 'lucide-react';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { ModalSheet } from './ModalSheet';
import { formatPhp } from '../lib/format';
import { recordDirectSale } from '../lib/inventory';
import type { Product, ProductMetrics } from '../types/models';

interface Props {
  open: boolean;
  onClose: () => void;
  products: Product[];
  metricsById: Map<string, ProductMetrics>;
  onOpenPos: () => void;
  onOpenProductInCatalog: (productId: string) => void;
  onCreateProductWithBarcode: (barcode: string) => void;
}

const QTY_PRESETS = [0.5, 1, 1.5, 2, 5];

export function QuickScanHub({
  open,
  onClose,
  products,
  metricsById,
  onOpenPos,
  onOpenProductInCatalog,
  onCreateProductWithBarcode,
}: Props) {
  const [hubMode, setHubMode] = useState<'camera' | 'quicktap'>('camera');
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [matchedProduct, setMatchedProduct] = useState<Product | null>(null);
  const [sellQty, setSellQty] = useState('1');
  const [quickSelling, setQuickSelling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Quick-Tap (No-Barcode) filter state
  const [pluQuery, setPluQuery] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [showAllItems, setShowAllItems] = useState(false);

  const isUnlabelled = (p: Product) => p.has_barcode === false || !p.barcode?.trim();

  const categories = useMemo(() => {
    const base = showAllItems ? products : products.filter(isUnlabelled);
    const set = new Set(base.map((p) => p.category).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [products, showAllItems]);

  const quickTapItems = useMemo(() => {
    const q = pluQuery.trim().toLowerCase();
    const base = showAllItems ? products : products.filter(isUnlabelled);
    return base
      .filter((p) => {
        if (!p.is_active) return false;
        if (catFilter !== 'all' && p.category !== catFilter) return false;
        if (!q) return true;
        return (
          (p.plu_code ?? '').toLowerCase() === q ||
          (p.plu_code ?? '').toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Exact PLU match floats to top, otherwise sort by 30d sales velocity
        if (q) {
          const aExact = (a.plu_code ?? '').toLowerCase() === q ? 1 : 0;
          const bExact = (b.plu_code ?? '').toLowerCase() === q ? 1 : 0;
          if (aExact !== bExact) return bExact - aExact;
        }
        const va = metricsById.get(a.id)?.totalUnitsSold30d ?? 0;
        const vb = metricsById.get(b.id)?.totalUnitsSold30d ?? 0;
        return vb - va;
      });
  }, [products, pluQuery, catFilter, showAllItems, metricsById]);

  const selectProduct = (p: Product) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(12);
    }
    setMatchedProduct(p);
    setScannedCode(p.plu_code ? `PLU ${p.plu_code}` : p.barcode || 'No barcode');
    setSellQty('1');
    setToast(null);
  };

  const handleDetected = (code: string) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(15);
    }
    const clean = code.trim().toLowerCase();
    const found = products.find(
      (p) =>
        p.barcode.toLowerCase() === clean ||
        p.sku.toLowerCase() === clean ||
        (p.plu_code && p.plu_code.toLowerCase() === clean)
    );
    setScannedCode(code);
    setMatchedProduct(found ?? null);
    setSellQty('1');
    setToast(null);
  };

  const resetAndClose = () => {
    setScannedCode(null);
    setMatchedProduct(null);
    setToast(null);
    setPluQuery('');
    onClose();
  };

  const handlePluSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = pluQuery.trim().toLowerCase();
    if (!q) return;
    const exact = products.find((p) => (p.plu_code ?? '').toLowerCase() === q);
    if (exact) {
      selectProduct(exact);
    } else if (quickTapItems.length === 1) {
      selectProduct(quickTapItems[0]);
    }
  };

  const handleQuickSell = async () => {
    if (!matchedProduct) return;
    const qty = Math.max(0.01, Number(sellQty) || 1);
    const total = Number((qty * matchedProduct.srp_price).toFixed(2));
    setQuickSelling(true);
    try {
      await recordDirectSale({
        saleType: 'retail',
        items: [{ productId: matchedProduct.id, qty, unitPrice: matchedProduct.srp_price }],
        amountPaid: total,
        paymentStatus: 'paid',
        notes: 'Quick scan / tap sale',
      });
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(15);
      }
      setToast(`Sold ${qty} ${matchedProduct.unit} of ${matchedProduct.name} (${formatPhp(total)})`);
    } finally {
      setQuickSelling(false);
    }
  };

  // Mode toggle pill shared in header
  const modeSwitcher = (
    <div className="flex rounded-full bg-[var(--surface-subtle)] p-0.5 text-[11px] font-medium">
      <button
        type="button"
        onClick={() => setHubMode('camera')}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
          hubMode === 'camera'
            ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-xs'
            : 'text-[var(--text-muted)]'
        }`}
      >
        <Camera className="h-3 w-3" strokeWidth={1.75} />
        Camera
      </button>
      <button
        type="button"
        onClick={() => setHubMode('quicktap')}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
          hubMode === 'quicktap'
            ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-xs'
            : 'text-[var(--text-muted)]'
        }`}
      >
        <Grid2x2 className="h-3 w-3" strokeWidth={1.75} />
        No-Barcode
      </button>
    </div>
  );

  // Phase 1A: Camera Scanner (with 1-tap switch to No-Barcode Quick-Tap)
  if (open && !scannedCode && hubMode === 'camera') {
    return (
      <>
        <BarcodeScannerModal
          open={open}
          onClose={resetAndClose}
          onDetected={handleDetected}
          title="Scan barcode"
          headerRight={modeSwitcher}
        />
      </>
    );
  }

  // Phase 1B: No-Barcode Quick-Tap + PLU Speed-Code Picker
  if (open && !scannedCode && hubMode === 'quicktap') {
    return (
      <ModalSheet
        open={open}
        onClose={resetAndClose}
        title="Quick tap"
        subtitle="Unlabelled items & PLU codes"
        maxWidth="max-w-md"
        headerRight={modeSwitcher}
      >
        <div className="space-y-3.5 p-4 sm:p-5">
          <form onSubmit={handlePluSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
                strokeWidth={1.5}
              />
              <input
                type="text"
                value={pluQuery}
                onChange={(e) => setPluQuery(e.target.value)}
                placeholder="Type PLU (e.g. 01) or item name"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="go"
                className="min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>
          </form>

          {/* Category filter chips + toggle All */}
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {categories.map((c) => {
              const active = catFilter === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCatFilter(c)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                    active
                      ? 'bg-[var(--accent)] text-white'
                      : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
                  }`}
                >
                  {c === 'all' ? 'All' : c}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowAllItems((v) => !v)}
              className={`ml-auto shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium ${
                showAllItems
                  ? 'bg-[var(--surface-subtle)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)]'
              }`}
            >
              {showAllItems ? 'Showing all' : 'Unlabelled only'}
            </button>
          </div>

          {quickTapItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-strong)] p-6 text-center text-xs text-[var(--text-muted)]">
              <p>No unlabelled items yet.</p>
              <p className="mt-1">
                When adding a product, toggle &ldquo;No barcode (unlabelled)&rdquo; to pin it here.
              </p>
              {!showAllItems && products.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllItems(true)}
                  className="mt-3 text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Show all {products.length} catalog items instead
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {quickTapItems.map((p) => {
                const m = metricsById.get(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProduct(p)}
                    className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-left hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)]"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="line-clamp-2 text-sm font-medium leading-snug text-[var(--text-primary)]">
                        {p.name}
                      </span>
                      {p.plu_code && (
                        <span className="shrink-0 rounded-md bg-[var(--accent-subtle)] px-1.5 py-0.5 font-mono-num text-[11px] font-semibold text-[var(--accent)]">
                          {p.plu_code}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <span className="font-mono-num text-[11px] text-[var(--text-muted)]">
                        {m?.mainQty ?? 0} {p.unit}
                      </span>
                      <span className="font-mono-num text-sm font-semibold text-[var(--text-primary)]">
                        {formatPhp(p.srp_price)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </ModalSheet>
    );
  }

  // Phase 2: Action Sheet for Selected / Scanned Item with 1-Tap Quantity Presets
  const metrics = matchedProduct ? metricsById.get(matchedProduct.id) : undefined;
  const qtyNum = Math.max(0.01, Number(sellQty) || 1);
  const lineTotal = matchedProduct ? Number((qtyNum * matchedProduct.srp_price).toFixed(2)) : 0;

  return (
    <ModalSheet
      open={open && Boolean(scannedCode)}
      onClose={resetAndClose}
      title={matchedProduct ? matchedProduct.name : 'New barcode detected'}
      subtitle={scannedCode ?? undefined}
      maxWidth="max-w-md"
    >
      <div className="space-y-4 p-5">
        {matchedProduct ? (
          <>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[var(--surface-subtle)] p-3.5 text-center">
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">SRP / {matchedProduct.unit}</div>
                <div className="mt-0.5 font-mono-num text-sm font-semibold text-[var(--text-primary)]">
                  {formatPhp(matchedProduct.srp_price)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Main stock</div>
                <div className="mt-0.5 font-mono-num text-sm font-semibold text-[var(--text-primary)]">
                  {metrics?.mainQty ?? 0} {matchedProduct.unit}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Favorability</div>
                <div className="mt-0.5 font-mono-num text-sm font-semibold text-[var(--accent)]">
                  {metrics?.favorabilityScore ?? 0}/100
                </div>
              </div>
            </div>

            {/* 1-Tap Weight / Quantity Presets */}
            <div>
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span className="font-medium">Quick quantity ({matchedProduct.unit})</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  min="0.01"
                  value={sellQty}
                  onChange={(e) => setSellQty(e.target.value)}
                  className="w-20 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-right font-mono-num text-xs text-[var(--text-primary)]"
                />
              </div>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {QTY_PRESETS.map((preset) => {
                  const active = Number(sellQty) === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setSellQty(String(preset))}
                      className={`min-h-[38px] rounded-xl font-mono-num text-xs font-medium ${
                        active
                          ? 'bg-[var(--accent)] text-white'
                          : 'border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)]'
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            </div>

            {toast && (
              <div className="rounded-xl bg-[var(--good-subtle)] px-3.5 py-2.5 text-xs font-medium text-[var(--good)]">
                {toast}
              </div>
            )}

            <div className="space-y-2">
              <button
                type="button"
                disabled={quickSelling}
                onClick={() => void handleQuickSell()}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                <ShoppingCart className="h-4 w-4" strokeWidth={1.75} />
                {quickSelling
                  ? 'Recording'
                  : `Quick sell ${qtyNum} ${matchedProduct.unit} (${formatPhp(lineTotal)})`}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = matchedProduct.id;
                    resetAndClose();
                    onOpenProductInCatalog(id);
                  }}
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)]"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Inspect &amp; edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetAndClose();
                    onOpenPos();
                  }}
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)]"
                >
                  <PackagePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Open full POS
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[var(--text-secondary)]">
              No product in your catalog matches barcode{' '}
              <span className="font-mono-num font-medium text-[var(--text-primary)]">{scannedCode}</span>.
            </p>
            <button
              type="button"
              onClick={() => {
                const code = scannedCode ?? '';
                resetAndClose();
                onCreateProductWithBarcode(code);
              }}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Create product with this barcode
            </button>
          </div>
        )}
      </div>
    </ModalSheet>
  );
}
