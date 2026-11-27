import { useMemo, useState } from 'react';
import {
  Download,
  Minus,
  Plus,
  Receipt,
  ScanBarcode,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { ReceiptModal } from '../components/ReceiptModal';
import { useBarcodeWedge } from '../hooks/useBarcodeWedge';
import { resolveWholesalePrice } from '../lib/algorithms';
import { exportToCsv, formatDateTime, formatPhp, todayIsoDate } from '../lib/format';
import { recordDirectSale } from '../lib/inventory';
import type {
  Batch,
  PaymentStatus,
  Product,
  Sale,
  SaleItem,
  Store,
  StorePriceOverride,
} from '../types/models';

interface Props {
  products: Product[];
  batches: Batch[];
  stores: Store[];
  overrides: StorePriceOverride[];
  sales: Sale[];
  saleItems: SaleItem[];
}

interface CartRow {
  productId: string;
  qty: number;
  unitPrice: number;
}

export function PosPage({ products, batches, stores, overrides, sales, saleItems }: Props) {
  const [saleType, setSaleType] = useState<'retail' | 'wholesale'>('retail');
  const [storeId, setStoreId] = useState('');
  const [cart, setCart] = useState<CartRow[]>([]);
  const [search, setSearch] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('paid');
  const [amountPaid, setAmountPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [activeReceipt, setActiveReceipt] = useState<{
    sale: Sale;
    items: SaleItem[];
    store?: Store;
  } | null>(null);

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const storesById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const overrideMap = useMemo(() => {
    if (!storeId) return new Map<string, StorePriceOverride>();
    return new Map(overrides.filter((o) => o.store === storeId).map((o) => [o.product, o]));
  }, [overrides, storeId]);

  const mainStockByProduct = useMemo(() => {
    const map = new Map<string, { qty: number; clearancePrice: number }>();
    const active = batches
      .filter((b) => b.location_type === 'main' && b.status === 'active' && b.remaining_qty > 0)
      .sort((a, b) => (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31'));

    for (const b of active) {
      const cur = map.get(b.product) ?? { qty: 0, clearancePrice: 0 };
      cur.qty += b.remaining_qty;
      if (cur.clearancePrice === 0 && b.clearance_price > 0) {
        cur.clearancePrice = b.clearance_price;
      }
      map.set(b.product, cur);
    }
    return map;
  }, [batches]);

  const getEffectivePrice = (p: Product) => {
    const stock = mainStockByProduct.get(p.id);
    if (stock && stock.clearancePrice > 0) return stock.clearancePrice;
    if (saleType === 'wholesale') {
      return resolveWholesalePrice(p, overrideMap.get(p.id));
    }
    return p.srp_price;
  };

  const addToCart = (p: Product) => {
    const unitPrice = getEffectivePrice(p);
    setCart((prev) => {
      const existing = prev.find((r) => r.productId === p.id);
      if (existing) {
        return prev.map((r) => (r.productId === p.id ? { ...r, qty: r.qty + 1 } : r));
      }
      return [...prev, { productId: p.id, qty: 1, unitPrice }];
    });
  };

  const handleScanCode = (code: string) => {
    const found = products.find(
      (p) => p.barcode.toLowerCase() === code.toLowerCase() || p.sku.toLowerCase() === code.toLowerCase()
    );
    if (found) addToCart(found);
  };

  useBarcodeWedge(handleScanCode, true);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.is_active) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, search]);

  const cartTotal = useMemo(
    () => Number(cart.reduce((s, r) => s + r.qty * r.unitPrice, 0).toFixed(2)),
    [cart]
  );

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      const paid =
        amountPaid.trim() === ''
          ? paymentStatus === 'paid'
            ? cartTotal
            : 0
          : Number(amountPaid) || 0;

      const { sale, saleItems: created } = await recordDirectSale({
        saleType,
        storeId: storeId || undefined,
        items: cart,
        amountPaid: paid,
        paymentStatus,
        notes,
      });

      setCart([]);
      setAmountPaid('');
      setNotes('');
      setActiveReceipt({
        sale,
        items: created,
        store: storeId ? storesById.get(storeId) : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const recentSales = useMemo(
    () => [...sales].sort((a, b) => b.sold_at.localeCompare(a.sold_at)).slice(0, 20),
    [sales]
  );

  const exportSalesCsv = () => {
    exportToCsv(
      `frostbite-sales-${todayIsoDate()}.csv`,
      recentSales.map((s) => ({
        receipt_no: s.receipt_no,
        sold_at: s.sold_at,
        sale_type: s.sale_type,
        store: s.store ? storesById.get(s.store)?.name ?? s.store : 'Walk-in',
        total_revenue: s.total_revenue,
        total_cost: s.total_cost,
        total_store_cut: s.total_store_cut,
        total_profit: s.total_profit,
        amount_paid: s.amount_paid,
        payment_status: s.payment_status,
      }))
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            Direct sales &amp; POS
          </h1>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Scan barcodes or tap items to record retail SRP or wholesale orders with automatic FEFO deduction
          </p>
        </div>
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
        >
          <ScanBarcode className="h-4 w-4" strokeWidth={1.5} />
          Scan item
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Product picker */}
        <div className="space-y-3 lg:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setSaleType('retail')}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  saleType === 'retail'
                    ? 'bg-[var(--surface-subtle)] font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                Retail (SRP)
              </button>
              <button
                type="button"
                onClick={() => setSaleType('wholesale')}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  saleType === 'wholesale'
                    ? 'bg-[var(--surface-subtle)] font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                Wholesale
              </button>
            </div>

            {saleType === 'wholesale' && (
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
              >
                <option value="">Walk-in wholesale</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter items or scan"
              className="flex-1 min-w-[160px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {filteredProducts.map((p) => {
              const stock = mainStockByProduct.get(p.id);
              const price = getEffectivePrice(p);
              const hasPromo = Boolean(stock && stock.clearancePrice > 0);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-left hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--text-primary)]">{p.name}</div>
                    <div className="mt-0.5 font-mono-num text-[11px] text-[var(--text-muted)]">
                      Stock: {stock?.qty ?? 0} {p.unit}
                      {hasPromo ? ' · Promo' : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono-num text-sm font-semibold text-[var(--text-primary)]">
                      {formatPhp(price)}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">per {p.unit}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Cart & Checkout */}
        <form
          onSubmit={handleCheckout}
          className="flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] lg:col-span-2"
        >
          <div>
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-[var(--text-secondary)]" strokeWidth={1.5} />
                <h2 className="text-sm font-medium text-[var(--text-primary)]">Order cart</h2>
              </div>
              <span className="font-mono-num text-xs text-[var(--text-muted)]">
                {cart.length} {cart.length === 1 ? 'line' : 'lines'}
              </span>
            </div>

            {cart.length === 0 ? (
              <p className="py-10 text-center text-xs text-[var(--text-muted)]">
                Scan a barcode or tap products on the left to build an order.
              </p>
            ) : (
              <div className="mt-3 divide-y divide-[var(--border)]">
                {cart.map((row) => {
                  const p = productsById.get(row.productId);
                  if (!p) return null;
                  return (
                    <div key={row.productId} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[var(--text-primary)]">{p.name}</div>
                        <div className="font-mono-num text-[11px] text-[var(--text-muted)]">
                          {formatPhp(row.unitPrice)} / {p.unit}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setCart((prev) =>
                              prev
                                .map((r) => (r.productId === row.productId ? { ...r, qty: r.qty - 1 } : r))
                                .filter((r) => r.qty > 0)
                            )
                          }
                          className="rounded border border-[var(--border-strong)] p-1 text-[var(--text-secondary)]"
                        >
                          <Minus className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={row.qty}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            setCart((prev) =>
                              prev.map((r) => (r.productId === row.productId ? { ...r, qty: val } : r))
                            );
                          }}
                          className="w-14 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-1.5 py-0.5 text-center font-mono-num text-xs"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setCart((prev) =>
                              prev.map((r) => (r.productId === row.productId ? { ...r, qty: r.qty + 1 } : r))
                            )
                          }
                          className="rounded border border-[var(--border-strong)] p-1 text-[var(--text-secondary)]"
                        >
                          <Plus className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                      </div>
                      <div className="w-20 text-right font-mono-num font-medium">
                        {formatPhp(row.qty * row.unitPrice)}
                      </div>
                      <button
                        type="button"
                        onClick={() => setCart((prev) => prev.filter((r) => r.productId !== row.productId))}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4 text-xs">
            <div className="flex items-baseline justify-between">
              <span className="text-[var(--text-secondary)]">Total due</span>
              <span className="font-mono-num text-lg font-semibold text-[var(--text-primary)]">
                {formatPhp(cartTotal)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-2 text-xs"
              >
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="unpaid">Unpaid</option>
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder={`Paid (${cartTotal})`}
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-2 font-mono-num text-xs"
              />
            </div>

            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional receipt note"
              className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs"
            />

            <button
              type="submit"
              disabled={cart.length === 0 || submitting}
              className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Recording sale' : `Complete ${saleType} sale`}
            </button>
          </div>
        </form>
      </div>

      {/* Recent Sales & Consignment Settlements Ledger */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">
            Recent sales &amp; settlements
          </h2>
          {recentSales.length > 0 && (
            <button
              type="button"
              onClick={exportSalesCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
              Export CSV
            </button>
          )}
        </div>

        {recentSales.length === 0 ? (
          <p className="mt-4 text-xs text-[var(--text-muted)]">No transactions recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th className="py-2 pr-3 font-medium">Receipt</th>
                  <th className="py-2 px-3 font-medium">Type / Store</th>
                  <th className="py-2 px-3 text-right font-medium">Revenue</th>
                  <th className="py-2 px-3 text-right font-medium">Net profit</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 pl-3 text-right font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {recentSales.map((s) => (
                  <tr key={s.id} className="hover:bg-[var(--surface-subtle)]">
                    <td className="py-2.5 pr-3">
                      <div className="font-mono-num font-medium text-[var(--text-primary)]">
                        {s.receipt_no}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {formatDateTime(s.sold_at)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-[var(--text-secondary)]">
                      <span className="capitalize">{s.sale_type.replace('_', ' ')}</span>
                      {s.store && ` · ${storesById.get(s.store)?.name ?? 'Store'}`}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num">{formatPhp(s.total_revenue)}</td>
                    <td className="py-2.5 px-3 text-right font-mono-num text-[var(--good)]">
                      {formatPhp(s.total_profit)}
                    </td>
                    <td className="py-2.5 px-3 capitalize text-[var(--text-secondary)]">
                      {s.payment_status}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveReceipt({
                            sale: s,
                            items: saleItems.filter((si) => si.sale === s.id),
                            store: s.store ? storesById.get(s.store) : undefined,
                          })
                        }
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                      >
                        <Receipt className="h-3.5 w-3.5" strokeWidth={1.5} />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleScanCode}
        title="Scan product to add to cart"
      />

      <ReceiptModal
        sale={activeReceipt?.sale ?? null}
        items={activeReceipt?.items ?? []}
        productsById={productsById}
        store={activeReceipt?.store}
        onClose={() => setActiveReceipt(null)}
      />
    </div>
  );
}
