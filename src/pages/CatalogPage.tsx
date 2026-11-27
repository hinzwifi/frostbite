import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  ScanBarcode,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { BarcodeLabelSheet } from '../components/BarcodeLabelSheet';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { ModalSheet } from '../components/ModalSheet';
import { useBarcodeWedge } from '../hooks/useBarcodeWedge';
import {
  buildProductVelocityChart,
  getExpiryUrgency,
  suggestClearancePrice,
} from '../lib/algorithms';
import {
  exportToCsv,
  formatDate,
  formatPhp,
  generateInternalBarcode,
  todayIsoDate,
} from '../lib/format';
import {
  deleteBatch,
  deleteProduct,
  receiveBatch,
  saveProduct,
  updateBatch,
  updateBatchClearance,
  writeOffBatch,
} from '../lib/inventory';
import type {
  Batch,
  ExpiryThresholds,
  PriceHistory,
  Product,
  ProductMetrics,
  Sale,
  SaleItem,
  Store,
} from '../types/models';

interface Props {
  products: Product[];
  metrics: ProductMetrics[];
  batches: Batch[];
  priceHistory: PriceHistory[];
  sales: Sale[];
  saleItems: SaleItem[];
  stores: Store[];
  thresholds: ExpiryThresholds;
  initialSelectedId?: string | null;
  initialNewBarcode?: string | null;
  onConsumeInitial?: () => void;
}

const EMPTY_FORM = {
  id: '',
  name: '',
  sku: '',
  barcode: '',
  has_barcode: true,
  plu_code: '',
  category: 'Poultry',
  unit: 'kg',
  supplier_name: '',
  buy_price: '',
  srp_price: '',
  wholesale_price: '',
  default_store_cut: '5',
  min_stock_level: '10',
  expiry_warn_days: '30',
  owner_favorability_boost: '0',
  notes: '',
  is_active: true,
};

export function CatalogPage({
  products,
  metrics,
  batches,
  priceHistory,
  sales,
  saleItems,
  stores,
  thresholds,
  initialSelectedId,
  initialNewBarcode,
  onConsumeInitial,
}: Props) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMode, setScanMode] = useState<'lookup' | 'form'>('lookup');
  const [labelProducts, setLabelProducts] = useState<Product[] | null>(null);

  // 3-step Add/Edit product wizard
  const [formOpen, setFormOpen] = useState(false);
  const [formStep, setFormStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Receive batch modal
  const [receiveTarget, setReceiveTarget] = useState<Product | null>(null);
  const [rxQty, setRxQty] = useState('10');
  const [rxBuy, setRxBuy] = useState('');
  const [rxExpiry, setRxExpiry] = useState('');
  const [rxUpdateBuy, setRxUpdateBuy] = useState(true);

  // Edit batch CRUD modal
  const [editBatchTarget, setEditBatchTarget] = useState<Batch | null>(null);
  const [ebQty, setEbQty] = useState('');
  const [ebBuy, setEbBuy] = useState('');
  const [ebExpiry, setEbExpiry] = useState('');
  const [ebClearance, setEbClearance] = useState('');

  useEffect(() => {
    if (initialSelectedId) {
      setSelectedId(initialSelectedId);
      onConsumeInitial?.();
    } else if (initialNewBarcode) {
      setForm({ ...EMPTY_FORM, barcode: initialNewBarcode });
      setFormStep(1);
      setFormOpen(true);
      onConsumeInitial?.();
    }
  }, [initialSelectedId, initialNewBarcode, onConsumeInitial]);

  const metricsById = useMemo(() => new Map(metrics.map((m) => [m.product.id, m])), [metrics]);
  const storesById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return metrics.filter(({ product }) => {
      if (categoryFilter !== 'all' && product.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        product.name.toLowerCase().includes(q) ||
        product.barcode.toLowerCase().includes(q) ||
        (product.plu_code ?? '').toLowerCase().includes(q) ||
        product.sku.toLowerCase().includes(q) ||
        product.supplier_name.toLowerCase().includes(q)
      );
    });
  }, [metrics, search, categoryFilter]);

  const handleBarcodeDetected = (code: string) => {
    if (scanMode === 'form') {
      setForm((f) => ({ ...f, barcode: code }));
      return;
    }
    const found = products.find(
      (p) => p.barcode.toLowerCase() === code.toLowerCase() || p.sku.toLowerCase() === code.toLowerCase()
    );
    if (found) {
      setSelectedId(found.id);
      setSearch(found.name);
    } else {
      // Offer quick creation with scanned barcode pre-filled
      setForm({ ...EMPTY_FORM, barcode: code });
      setFormOpen(true);
    }
  };

  useBarcodeWedge((code) => {
    if (!formOpen && !receiveTarget) {
      handleBarcodeDetected(code);
    }
  }, true);

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, barcode: generateInternalBarcode() });
    setFormStep(1);
    setFormOpen(true);
  };

  const openEdit = (p: Product) => {
    setForm({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      has_barcode: p.has_barcode !== false && Boolean(p.barcode),
      plu_code: p.plu_code ?? '',
      category: p.category || 'Frozen',
      unit: p.unit,
      supplier_name: p.supplier_name,
      buy_price: String(p.buy_price),
      srp_price: String(p.srp_price),
      wholesale_price: String(p.wholesale_price),
      default_store_cut: String(p.default_store_cut),
      min_stock_level: String(p.min_stock_level),
      expiry_warn_days: String(p.expiry_warn_days || 30),
      owner_favorability_boost: String(p.owner_favorability_boost || 0),
      notes: p.notes,
      is_active: p.is_active,
    });
    setFormStep(1);
    setFormOpen(true);
  };

  const openEditBatch = (b: Batch) => {
    setEditBatchTarget(b);
    setEbQty(String(b.remaining_qty));
    setEbBuy(String(b.buy_price));
    setEbExpiry(b.expiry_date || '');
    setEbClearance(String(b.clearance_price || 0));
  };

  const handleSaveBatchEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editBatchTarget) return;
    await updateBatch(editBatchTarget, {
      remaining_qty: Number(ebQty) || 0,
      buy_price: Number(ebBuy) || 0,
      expiry_date: ebExpiry,
      clearance_price: Number(ebClearance) || 0,
    });
    setEditBatchTarget(null);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await saveProduct({
        id: form.id || undefined,
        name: form.name.trim(),
        sku: form.sku.trim(),
        barcode: form.has_barcode ? form.barcode.trim() : '',
        has_barcode: form.has_barcode,
        plu_code: form.plu_code.trim(),
        category: form.category.trim() || 'Frozen',
        unit: form.unit.trim() || 'pack',
        supplier_name: form.supplier_name.trim(),
        buy_price: Number(form.buy_price) || 0,
        srp_price: Number(form.srp_price) || 0,
        wholesale_price: Number(form.wholesale_price) || 0,
        default_store_cut: Number(form.default_store_cut) || 0,
        min_stock_level: Number(form.min_stock_level) || 0,
        expiry_warn_days: Number(form.expiry_warn_days) || 30,
        owner_favorability_boost: Number(form.owner_favorability_boost) || 0,
        notes: form.notes.trim(),
        is_active: form.is_active,
      });
      setFormOpen(false);
      setSelectedId(saved.id);
    } finally {
      setSaving(false);
    }
  };

  const openReceive = (p: Product) => {
    setReceiveTarget(p);
    setRxQty('10');
    setRxBuy(String(p.buy_price));
    const d = new Date();
    d.setDate(d.getDate() + 90);
    setRxExpiry(d.toISOString().slice(0, 10));
    setRxUpdateBuy(true);
  };

  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveTarget) return;
    await receiveBatch({
      productId: receiveTarget.id,
      qty: Number(rxQty) || 0,
      buyPrice: Number(rxBuy) || receiveTarget.buy_price,
      expiryDate: rxExpiry,
      updateProductBuyPrice: rxUpdateBuy,
    });
    setReceiveTarget(null);
  };

  const selectedMetrics = selectedId ? metricsById.get(selectedId) ?? null : null;

  const selectedPriceChart = useMemo(() => {
    if (!selectedId) return [];
    return priceHistory
      .filter((ph) => ph.product === selectedId)
      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
      .map((ph) => ({
        date: formatDate(ph.recorded_at),
        buy: ph.buy_price,
        wholesale: ph.wholesale_price,
        srp: ph.srp_price,
      }));
  }, [priceHistory, selectedId]);

  const selectedVelocityChart = useMemo(() => {
    if (!selectedMetrics) return [];
    return buildProductVelocityChart(
      selectedMetrics.product.id,
      saleItems,
      sales,
      selectedMetrics.dailyVelocity
    );
  }, [selectedMetrics, saleItems, sales]);

  const selectedBatches = useMemo(() => {
    if (!selectedId) return [];
    return batches
      .filter((b) => b.product === selectedId && b.status === 'active' && b.remaining_qty > 0)
      .sort((a, b) => (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31'));
  }, [batches, selectedId]);

  const handleExportCsv = () => {
    exportToCsv(
      `frostbite-catalog-${todayIsoDate()}.csv`,
      metrics.map((m) => ({
        name: m.product.name,
        barcode: m.product.barcode,
        category: m.product.category,
        unit: m.product.unit,
        supplier: m.product.supplier_name,
        buy_price: m.product.buy_price,
        wholesale_price: m.product.wholesale_price,
        srp_price: m.product.srp_price,
        srp_margin_pct: m.srpMarginPct,
        main_stock: m.mainQty,
        store_stock: m.storeQty,
        favorability_score: m.favorabilityScore,
        forecast_14d: m.forecast14d,
        nearest_expiry: m.nearestExpiryDate ?? '',
      }))
    );
  };

  return (
    <div className="space-y-5">
      <div className="hidden flex-wrap items-center justify-between gap-3 md:flex">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            Catalog &amp; FEFO inventory
          </h1>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Scan any barcode to inspect price history, batches, or receive fresh stock
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setScanMode('lookup');
              setScannerOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
          >
            <ScanBarcode className="h-4 w-4 text-[var(--text-secondary)]" strokeWidth={1.5} />
            Scan barcode
          </button>
          {products.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setLabelProducts(filtered.map((f) => f.product))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
              >
                <Printer className="h-4 w-4 text-[var(--text-secondary)]" strokeWidth={1.5} />
                Print labels
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
              >
                <Download className="h-4 w-4 text-[var(--text-secondary)]" strokeWidth={1.5} />
                CSV
              </button>
            </>
          )}
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Add product
          </button>
        </div>
      </div>

      {/* Compact search + inline barcode scan (Google/Reddit mobile pattern) */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
              strokeWidth={1.5}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, barcode, or supplier"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="search"
              className="min-h-[42px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] md:min-h-0 md:rounded-lg"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setScanMode('lookup');
              setScannerOpen(true);
            }}
            aria-label="Scan barcode"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] md:hidden"
          >
            <ScanBarcode className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="hidden rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] md:block"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'All categories' : c}
              </option>
            ))}
          </select>
        </div>

        {/* Horizontal category chip bar on mobile (YouTube / Reddit / FB pattern) */}
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-0.5 md:hidden">
          {categories.map((c) => {
            const active = categoryFilter === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${
                  active
                    ? 'bg-[var(--accent)] text-white'
                    : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
                }`}
              >
                {c === 'all' ? 'All' : c}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile Feed Cards (zero horizontal scroll) */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-8 text-center text-xs text-[var(--text-muted)]">
            No frozen products yet. Tap the + button to add your first item.
          </div>
        ) : (
          filtered.map((m) => {
            const isSelected = selectedId === m.product.id;
            const exp = getExpiryUrgency(m.nearestExpiryDate, thresholds);
            const dotColor =
              exp.urgency === 'expired' || exp.urgency === 'critical'
                ? 'bg-[var(--danger)]'
                : exp.urgency === 'warn14'
                  ? 'bg-[var(--warn)]'
                  : exp.urgency === 'warn30'
                    ? 'bg-[var(--accent)]'
                    : '';

            return (
              <div
                key={m.product.id}
                onClick={() => setSelectedId(isSelected ? null : m.product.id)}
                className={`rounded-xl border p-3.5 ${
                  isSelected
                    ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                    : 'border-[var(--border)] bg-[var(--surface)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {m.product.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                      {m.product.has_barcode === false || !m.product.barcode
                        ? m.product.plu_code
                          ? `PLU ${m.product.plu_code}`
                          : 'No barcode'
                        : m.product.barcode}{' '}
                      · {m.product.category} · per {m.product.unit}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono-num text-sm font-semibold text-[var(--text-primary)]">
                      {formatPhp(m.product.srp_price)}
                    </div>
                    <div className="font-mono-num text-[11px] text-[var(--good)]">+{m.srpMarginPct}%</div>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5 text-[11px]">
                  <div className="flex items-center gap-3 font-mono-num text-[var(--text-secondary)]">
                    <span>Buy {formatPhp(m.product.buy_price)}</span>
                    <span>
                      Stock {m.mainQty}/{m.storeQty}
                    </span>
                    {m.nearestExpiryDate && (
                      <span className="inline-flex items-center gap-1">
                        {dotColor && <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />}
                        {formatDate(m.nearestExpiryDate)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openReceive(m.product)}
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-[var(--surface-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)]"
                    >
                      <PackagePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                      Receive
                    </button>
                    <button
                      type="button"
                      onClick={() => setLabelProducts([m.product])}
                      aria-label={`Print label for ${m.product.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-subtle)] text-[var(--text-secondary)]"
                    >
                      <Printer className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(m.product)}
                      aria-label={`Edit ${m.product.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-subtle)] text-[var(--text-secondary)]"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Mobile Floating Action Button (FAB) */}
      <button
        type="button"
        onClick={openAdd}
        aria-label="Add frozen product"
        className="no-print fixed bottom-[76px] right-4 z-30 flex h-13 w-13 items-center justify-center rounded-2xl bg-[var(--accent)] text-white shadow-lg md:hidden"
      >
        <Plus className="h-6 w-6" strokeWidth={2} />
      </button>

      {/* Desktop Product table */}
      <div className="hidden overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--text-muted)]">
                <th className="py-2.5 pl-4 pr-3 font-medium">Product</th>
                <th className="py-2.5 px-3 text-right font-medium">Buy</th>
                <th className="py-2.5 px-3 text-right font-medium">Wholesale</th>
                <th className="py-2.5 px-3 text-right font-medium">SRP</th>
                <th className="py-2.5 px-3 text-right font-medium">Main / Stores</th>
                <th className="py-2.5 px-3 text-right font-medium">Favorability</th>
                <th className="py-2.5 px-3 font-medium">Nearest expiry</th>
                <th className="py-2.5 pl-3 pr-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-[var(--text-muted)]">
                    No frozen products found. Click &ldquo;Add product&rdquo; to create your first item.
                  </td>
                </tr>
              ) : (
                filtered.map((m) => {
                  const isSelected = selectedId === m.product.id;
                  const exp = getExpiryUrgency(m.nearestExpiryDate, thresholds);
                  const dotColor =
                    exp.urgency === 'expired' || exp.urgency === 'critical'
                      ? 'bg-[var(--danger)]'
                      : exp.urgency === 'warn14'
                        ? 'bg-[var(--warn)]'
                        : exp.urgency === 'warn30'
                          ? 'bg-[var(--accent)]'
                          : '';

                  return (
                    <tr
                      key={m.product.id}
                      onClick={() => setSelectedId(isSelected ? null : m.product.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[var(--accent-subtle)]'
                          : 'hover:bg-[var(--surface-subtle)]'
                      }`}
                    >
                      <td className="py-3 pl-4 pr-3">
                        <div className="font-medium text-[var(--text-primary)]">{m.product.name}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                          <span className="font-mono-num">
                            {m.product.has_barcode === false || !m.product.barcode
                              ? m.product.plu_code
                                ? `PLU ${m.product.plu_code}`
                                : 'Unlabelled'
                              : m.product.barcode}
                          </span>
                          <span>·</span>
                          <span>{m.product.category}</span>
                          <span>·</span>
                          <span>per {m.product.unit}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-[var(--text-secondary)]">
                        <div>{formatPhp(m.product.buy_price)}</div>
                        {m.priceTrend !== 'stable' && (
                          <div
                            className={`text-[11px] ${
                              m.priceTrend === 'spiking' ? 'text-[var(--danger)]' : 'text-[var(--good)]'
                            }`}
                          >
                            {m.priceTrendPct > 0 ? `+${m.priceTrendPct}%` : `${m.priceTrendPct}%`}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-[var(--text-primary)]">
                        {formatPhp(m.product.wholesale_price)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-[var(--text-primary)]">
                        <div>{formatPhp(m.product.srp_price)}</div>
                        <div className="text-[11px] text-[var(--good)]">+{m.srpMarginPct}%</div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num">
                        <span className="text-[var(--text-primary)]">{m.mainQty}</span>
                        <span className="text-[var(--text-muted)]"> / {m.storeQty}</span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num">
                        <span
                          className={`font-medium ${
                            m.favorabilityScore >= 70
                              ? 'text-[var(--good)]'
                              : m.favorabilityScore >= 40
                                ? 'text-[var(--text-primary)]'
                                : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {m.favorabilityScore}/100
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono-num text-[var(--text-secondary)]">
                        {m.nearestExpiryDate ? (
                          <span className="inline-flex items-center gap-1.5">
                            {dotColor && <span className={`h-2 w-2 rounded-full ${dotColor}`} />}
                            <span
                              className={
                                exp.urgency === 'expired' || exp.urgency === 'critical'
                                  ? 'text-[var(--danger)] font-medium'
                                  : exp.urgency === 'warn14'
                                    ? 'text-[var(--warn)] font-medium'
                                    : ''
                              }
                            >
                              {formatDate(m.nearestExpiryDate)}
                            </span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className="py-3 pl-3 pr-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openReceive(m.product)}
                            title="Receive FEFO batch"
                            className="rounded-md border border-[var(--border-strong)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors inline-flex items-center gap-1"
                          >
                            <PackagePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                            Receive
                          </button>
                          <button
                            type="button"
                            onClick={() => setLabelProducts([m.product])}
                            title="Print barcode label"
                            className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
                          >
                            <Printer className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(m.product)}
                            title="Edit product"
                            className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Delete ${m.product.name}?`)) {
                                void deleteProduct(m.product.id);
                                if (selectedId === m.product.id) setSelectedId(null);
                              }
                            }}
                            title="Delete product"
                            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)] transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Product Deep-Dive Charts & FEFO Batches */}
      {selectedMetrics && (
        <div className="space-y-5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {selectedMetrics.product.name}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                Supplier: {selectedMetrics.product.supplier_name || 'Unassigned'} · Store cut:{' '}
                <span className="font-mono-num">
                  {formatPhp(selectedMetrics.product.default_store_cut)}/{selectedMetrics.product.unit}
                </span>{' '}
                · Forecast 14d:{' '}
                <span className="font-mono-num">
                  {selectedMetrics.forecast14d} {selectedMetrics.product.unit}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] transition-colors"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Price History Chart */}
            <div>
              <h3 className="text-xs font-medium text-[var(--text-secondary)]">
                Price history (Buy vs. Wholesale vs. SRP)
              </h3>
              <div className="mt-3 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={selectedPriceChart} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `₱${v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '10px',
                        fontSize: '12px',
                      }}
                      formatter={(v) => formatPhp(Number(v))}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line type="monotone" dataKey="srp" name="SRP" stroke="#0284c7" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="wholesale" name="Wholesale" stroke="#059669" strokeWidth={1.75} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="buy" name="Buy cost" stroke="#64748b" strokeWidth={1.75} strokeDasharray="4 3" dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Sales Velocity & 7-Day Forecast Chart */}
            <div>
              <h3 className="text-xs font-medium text-[var(--text-secondary)]">
                Sales velocity (14d actual + 7d forecast)
              </h3>
              <div className="mt-3 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={selectedVelocityChart} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '10px',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line type="monotone" dataKey="actual" name="Actual sold" stroke="#0284c7" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                    <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#d97706" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Active FEFO Batches */}
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-[var(--text-secondary)]">
                Active FEFO batches ({selectedBatches.length})
              </h3>
              <button
                type="button"
                onClick={() => openReceive(selectedMetrics.product)}
                className="text-xs font-medium text-[var(--accent)] hover:underline"
              >
                + Receive new batch
              </button>
            </div>
            {selectedBatches.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--text-muted)]">No active stock batches yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="py-2 pr-3 font-medium">Batch</th>
                      <th className="py-2 px-3 font-medium">Location</th>
                      <th className="py-2 px-3 text-right font-medium">Buy cost</th>
                      <th className="py-2 px-3 text-right font-medium">Remaining</th>
                      <th className="py-2 px-3 font-medium">Expiry</th>
                      <th className="py-2 pl-3 text-right font-medium">Promo / Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {selectedBatches.map((b) => {
                      const clearance = suggestClearancePrice(selectedMetrics.product, b, thresholds);
                      return (
                        <tr key={b.id}>
                          <td className="py-2 pr-3 font-mono-num text-[var(--text-primary)]">{b.batch_code}</td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">
                            {b.location_type === 'main'
                              ? 'Main freezer'
                              : storesById.get(b.store)?.name ?? 'Store'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num">{formatPhp(b.buy_price)}</td>
                          <td className="py-2 px-3 text-right font-mono-num">
                            {b.remaining_qty} / {b.initial_qty}
                          </td>
                          <td className="py-2 px-3 font-mono-num">{formatDate(b.expiry_date)}</td>
                          <td className="py-2 pl-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              {clearance && clearance.suggestedPrice > 0 && (
                                <button
                                  type="button"
                                  onClick={() => void updateBatchClearance(b, clearance.suggestedPrice)}
                                  className="rounded-md border border-[var(--border-strong)] px-2 py-0.5 text-[11px] hover:bg-[var(--surface-subtle)]"
                                >
                                  Promo {formatPhp(clearance.suggestedPrice)}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditBatch(b)}
                                className="text-[11px] font-medium text-[var(--accent)] hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void writeOffBatch(b)}
                                className="text-[11px] text-[var(--warn)] hover:underline"
                              >
                                Write off
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (window.confirm(`Delete batch ${b.batch_code}?`)) {
                                    void deleteBatch(b.id);
                                  }
                                }}
                                className="text-[11px] text-[var(--danger)] hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3-Step Apple Bottom-Sheet Add/Edit Product Wizard */}
      <ModalSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? 'Edit product' : 'New frozen product'}
        subtitle={`Step ${formStep} of 3 · ${
          formStep === 1 ? 'Basics & barcode' : formStep === 2 ? 'Pricing & margin' : 'Alerts & notes'
        }`}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSaveProduct} className="space-y-4 p-5 text-xs">
          {/* Step progress bar */}
          <div className="grid grid-cols-3 gap-1.5">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1 rounded-full ${
                  formStep >= s ? 'bg-[var(--accent)]' : 'bg-[var(--surface-subtle)]'
                }`}
              />
            ))}
          </div>

          {formStep === 1 && (
            <div className="space-y-3">
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Product name</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Dressed Chicken, Pork Sisig 500g"
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>

              {/* No-barcode toggle for loose / unlabelled frozen goods */}
              <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3.5 py-2.5">
                <div>
                  <div className="font-medium text-[var(--text-primary)]">No barcode (unlabelled item)</div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Pins item to Quick-Tap &amp; PLU lookup — no sticker needed
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!form.has_barcode}
                  onClick={() => setForm((f) => ({ ...f, has_barcode: !f.has_barcode }))}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    !form.has_barcode ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
                  }`}
                >
                  <span
                    className={`block h-5 w-5 rounded-full bg-white shadow-xs transition-transform ${
                      !form.has_barcode ? 'translate-x-5.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {form.has_barcode ? (
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Barcode</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={form.barcode}
                      onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                      data-barcode-target="true"
                      autoCapitalize="none"
                      autoCorrect="off"
                      className="min-h-[44px] flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setScanMode('form');
                        setScannerOpen(true);
                      }}
                      aria-label="Scan barcode"
                      className="flex h-[44px] w-[44px] items-center justify-center rounded-xl border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                    >
                      <ScanBarcode className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">
                    Short PLU speed-code (optional, e.g. 01, 02, 105)
                  </label>
                  <input
                    value={form.plu_code}
                    onChange={(e) => setForm({ ...form, plu_code: e.target.value })}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="e.g. 01"
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Unit</label>
                  <input
                    required
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    placeholder="kg, pack, pc"
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Category</label>
                  <input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="Poultry, Pork, Processed"
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Supplier name</label>
                <input
                  value={form.supplier_name}
                  onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                  placeholder="Primary supplier"
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
            </div>
          )}

          {formStep === 2 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Buy cost (₱)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    required
                    value={form.buy_price}
                    onChange={(e) => setForm({ ...form, buy_price: e.target.value })}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">SRP retail (₱)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    required
                    value={form.srp_price}
                    onChange={(e) => setForm({ ...form, srp_price: e.target.value })}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Wholesale (₱)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    required
                    value={form.wholesale_price}
                    onChange={(e) => setForm({ ...form, wholesale_price: e.target.value })}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Store cut (₱/unit)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0"
                    value={form.default_store_cut}
                    onChange={(e) => setForm({ ...form, default_store_cut: e.target.value })}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>

              {/* Live margin preview */}
              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-[var(--surface-subtle)] p-3.5">
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">Direct SRP profit</div>
                  <div className="mt-0.5 font-mono-num text-sm font-semibold text-[var(--good)]">
                    {formatPhp((Number(form.srp_price) || 0) - (Number(form.buy_price) || 0))} / {form.unit || 'unit'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)]">Consignment profit</div>
                  <div className="mt-0.5 font-mono-num text-sm font-semibold text-[var(--accent)]">
                    {formatPhp(
                      (Number(form.srp_price) || 0) -
                        (Number(form.default_store_cut) || 0) -
                        (Number(form.buy_price) || 0)
                    )}{' '}
                    / {form.unit || 'unit'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {formStep === 3 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Min stock alert</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={form.min_stock_level}
                    onChange={(e) => setForm({ ...form, min_stock_level: e.target.value })}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">
                    Favorability boost (-20..+20)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="-20"
                    max="20"
                    value={form.owner_favorability_boost}
                    onChange={(e) => setForm({ ...form, owner_favorability_boost: e.target.value })}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Owner notes</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional notes (e.g. fast seller on weekends)"
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-4">
            <div>
              {form.id && formStep === 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete ${form.name}?`)) {
                      void deleteProduct(form.id);
                      setFormOpen(false);
                      if (selectedId === form.id) setSelectedId(null);
                    }
                  }}
                  className="rounded-xl px-3 py-2 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-subtle)]"
                >
                  Delete
                </button>
              )}
              {formStep > 1 && (
                <button
                  type="button"
                  onClick={() => setFormStep((s) => (s === 3 ? 2 : 1))}
                  className="inline-flex min-h-[42px] items-center gap-1 rounded-xl border border-[var(--border-strong)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Back
                </button>
              )}
            </div>

            {formStep < 3 ? (
              <button
                type="button"
                onClick={() => {
                  if (formStep === 1 && !form.name.trim()) return;
                  setFormStep((s) => (s === 1 ? 2 : 3));
                }}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={saving}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-5 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
                {saving ? 'Saving' : 'Save product'}
              </button>
            )}
          </div>
        </form>
      </ModalSheet>

      {/* Receive FEFO Batch Bottom Sheet */}
      <ModalSheet
        open={Boolean(receiveTarget)}
        onClose={() => setReceiveTarget(null)}
        title="Receive FEFO batch"
        subtitle={receiveTarget?.name}
        maxWidth="max-w-md"
      >
        {receiveTarget && (
          <form onSubmit={handleReceiveSubmit} className="space-y-3 p-5 text-xs">
            <div>
              <label className="block font-medium text-[var(--text-secondary)]">
                Quantity ({receiveTarget.unit})
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                value={rxQty}
                onChange={(e) => setRxQty(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label className="block font-medium text-[var(--text-secondary)]">Batch buy price (₱)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                required
                value={rxBuy}
                onChange={(e) => setRxBuy(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label className="block font-medium text-[var(--text-secondary)]">Expiration date</label>
              <input
                type="date"
                required
                value={rxExpiry}
                onChange={(e) => setRxExpiry(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </div>

            <label className="flex items-center gap-2 pt-1 text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={rxUpdateBuy}
                onChange={(e) => setRxUpdateBuy(e.target.checked)}
              />
              Update product buy cost &amp; log price history if changed
            </label>

            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={() => setReceiveTarget(null)}
                className="min-h-[42px] rounded-xl border border-[var(--border-strong)] px-4 py-2 text-xs font-medium text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                Receive into freezer
              </button>
            </div>
          </form>
        )}
      </ModalSheet>

      {/* Edit Batch CRUD Sheet */}
      <ModalSheet
        open={Boolean(editBatchTarget)}
        onClose={() => setEditBatchTarget(null)}
        title="Edit FEFO batch"
        subtitle={editBatchTarget?.batch_code}
        maxWidth="max-w-md"
      >
        {editBatchTarget && (
          <form onSubmit={handleSaveBatchEdit} className="space-y-3 p-5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Remaining qty</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  required
                  value={ebQty}
                  onChange={(e) => setEbQty(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Buy cost (₱)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  required
                  value={ebBuy}
                  onChange={(e) => setEbBuy(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Expiration date</label>
                <input
                  type="date"
                  value={ebExpiry}
                  onChange={(e) => setEbExpiry(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Clearance price (₱)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={ebClearance}
                  onChange={(e) => setEbClearance(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
                />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete batch ${editBatchTarget.batch_code}?`)) {
                    void deleteBatch(editBatchTarget.id);
                    setEditBatchTarget(null);
                  }
                }}
                className="rounded-xl px-3 py-2 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-subtle)]"
              >
                Delete batch
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white"
              >
                Save batch
              </button>
            </div>
          </form>
        )}
      </ModalSheet>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleBarcodeDetected}
      />

      <BarcodeLabelSheet
        products={labelProducts ?? []}
        open={Boolean(labelProducts && labelProducts.length > 0)}
        onClose={() => setLabelProducts(null)}
      />
    </div>
  );
}
