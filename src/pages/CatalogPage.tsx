import { useMemo, useState } from 'react';
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
  deleteProduct,
  receiveBatch,
  saveProduct,
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
}

const EMPTY_FORM = {
  id: '',
  name: '',
  sku: '',
  barcode: '',
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
}: Props) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMode, setScanMode] = useState<'lookup' | 'form'>('lookup');
  const [labelProducts, setLabelProducts] = useState<Product[] | null>(null);

  // Add/Edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Receive batch modal
  const [receiveTarget, setReceiveTarget] = useState<Product | null>(null);
  const [rxQty, setRxQty] = useState('10');
  const [rxBuy, setRxBuy] = useState('');
  const [rxExpiry, setRxExpiry] = useState('');
  const [rxUpdateBuy, setRxUpdateBuy] = useState(true);

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
    setFormOpen(true);
  };

  const openEdit = (p: Product) => {
    setForm({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
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
    setFormOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await saveProduct({
        id: form.id || undefined,
        name: form.name.trim(),
        sku: form.sku.trim(),
        barcode: form.barcode.trim(),
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition-colors"
          >
            <ScanBarcode className="h-4 w-4 text-[var(--text-secondary)]" strokeWidth={1.5} />
            Scan barcode
          </button>
          {products.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setLabelProducts(filtered.map((f) => f.product))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition-colors"
              >
                <Printer className="h-4 w-4 text-[var(--text-secondary)]" strokeWidth={1.5} />
                Print labels
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition-colors"
              >
                <Download className="h-4 w-4 text-[var(--text-secondary)]" strokeWidth={1.5} />
                CSV
              </button>
            </>
          )}
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Add product
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
            strokeWidth={1.5}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, barcode, SKU, or supplier"
            className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All categories' : c}
            </option>
          ))}
        </select>
      </div>

      {/* Product table */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
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
                          <span className="font-mono-num">{m.product.barcode}</span>
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
                                onClick={() => void writeOffBatch(b)}
                                className="text-[11px] text-[var(--danger)] hover:underline"
                              >
                                Write off
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

      {/* Add/Edit Product Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-lg">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
                {form.id ? 'Edit product' : 'Add frozen product'}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-[var(--text-secondary)]">Product name</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Dressed Chicken, Pork Sisig 500g"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Barcode</label>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      value={form.barcode}
                      onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                      data-barcode-target="true"
                      className="flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setScanMode('form');
                        setScannerOpen(true);
                      }}
                      className="rounded-lg border border-[var(--border-strong)] px-2.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                      title="Scan barcode"
                    >
                      <ScanBarcode className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Unit</label>
                  <input
                    required
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    placeholder="kg, pack, pc, box"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Category</label>
                  <input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="Poultry, Pork, Processed, Seafood"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Supplier name</label>
                  <input
                    value={form.supplier_name}
                    onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                    placeholder="Primary supplier"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Buy cost (₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={form.buy_price}
                    onChange={(e) => setForm({ ...form, buy_price: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Wholesale price (₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={form.wholesale_price}
                    onChange={(e) => setForm({ ...form, wholesale_price: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">SRP retail price (₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={form.srp_price}
                    onChange={(e) => setForm({ ...form, srp_price: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">
                    Default store cut (₱/unit)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={form.default_store_cut}
                    onChange={(e) => setForm({ ...form, default_store_cut: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Min stock alert</label>
                  <input
                    type="number"
                    min="0"
                    value={form.min_stock_level}
                    onChange={(e) => setForm({ ...form, min_stock_level: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">
                    Owner favorability boost (-20 to +20)
                  </label>
                  <input
                    type="number"
                    min="-20"
                    max="20"
                    value={form.owner_favorability_boost}
                    onChange={(e) => setForm({ ...form, owner_favorability_boost: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-[var(--text-secondary)]">Owner notes</label>
                  <input
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Optional notes (e.g. fast seller on weekends)"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                >
                  {saving ? 'Saving' : 'Save product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receive Batch Modal */}
      {receiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-lg">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div>
                <h2 className="text-[15px] font-medium text-[var(--text-primary)]">Receive FEFO batch</h2>
                <p className="text-xs text-[var(--text-secondary)]">{receiveTarget.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setReceiveTarget(null)}
                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleReceiveSubmit} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">
                  Quantity ({receiveTarget.unit})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={rxQty}
                  onChange={(e) => setRxQty(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Batch buy price (₱)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={rxBuy}
                  onChange={(e) => setRxBuy(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Expiration date</label>
                <input
                  type="date"
                  required
                  value={rxExpiry}
                  onChange={(e) => setRxExpiry(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
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
                  className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-xs font-medium text-[var(--text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  Receive into freezer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
