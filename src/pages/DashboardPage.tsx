import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  Package,
  Store as StoreIcon,
  TrendingUp,
} from 'lucide-react';
import {
  DEFAULT_EXPIRY_THRESHOLDS,
  getExpiryUrgency,
  suggestClearancePrice,
} from '../lib/algorithms';
import { formatDate, formatPhp } from '../lib/format';
import { updateBatchClearance, writeOffBatch } from '../lib/inventory';
import type {
  Batch,
  ExpiryThresholds,
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
  stores: Store[];
  sales: Sale[];
  saleItems: SaleItem[];
  thresholds: ExpiryThresholds;
  onNavigate: (tab: 'catalog' | 'stores' | 'pos' | 'optimizer') => void;
}

export function DashboardPage({
  products,
  metrics,
  batches,
  stores,
  sales,
  saleItems,
  thresholds = DEFAULT_EXPIRY_THRESHOLDS,
  onNavigate,
}: Props) {
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const storesById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const kpis = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
    const recentSales = sales.filter((s) => new Date(s.sold_at).getTime() >= thirtyDaysAgo);
    const profit30d = recentSales.reduce((s, r) => s + r.total_profit, 0);
    const revenue30d = recentSales.reduce((s, r) => s + r.total_revenue, 0);

    const activeBatches = batches.filter((b) => b.status === 'active' && b.remaining_qty > 0);
    const mainValue = activeBatches
      .filter((b) => b.location_type === 'main')
      .reduce((s, b) => s + b.remaining_qty * b.buy_price, 0);
    const placedValue = activeBatches
      .filter((b) => b.location_type === 'store')
      .reduce((s, b) => s + b.remaining_qty * b.buy_price, 0);

    const nearExpiry = activeBatches.filter((b) => {
      const { urgency } = getExpiryUrgency(b.expiry_date, thresholds);
      return urgency === 'expired' || urgency === 'critical' || urgency === 'warn14' || urgency === 'warn30';
    });

    return { profit30d, revenue30d, mainValue, placedValue, nearExpiryCount: nearExpiry.length };
  }, [sales, batches, thresholds]);

  const favorabilityChartData = useMemo(() => {
    return [...metrics]
      .sort((a, b) => b.favorabilityScore - a.favorabilityScore)
      .slice(0, 10)
      .map((m) => ({
        name: m.product.name.length > 18 ? `${m.product.name.slice(0, 17)}…` : m.product.name,
        fullName: m.product.name,
        favorability: m.favorabilityScore,
        marginPct: m.srpMarginPct,
        velocity: m.dailyVelocity,
      }));
  }, [metrics]);

  const storePerformance = useMemo(() => {
    const salesByStore = new Map<string, { revenue: number; profit: number; units: number }>();
    const salesById = new Map(sales.map((s) => [s.id, s]));

    for (const s of sales) {
      if (!s.store) continue;
      const cur = salesByStore.get(s.store) ?? { revenue: 0, profit: 0, units: 0 };
      cur.revenue += s.total_revenue;
      cur.profit += s.total_profit;
      salesByStore.set(s.store, cur);
    }

    for (const si of saleItems) {
      const s = salesById.get(si.sale);
      if (!s?.store) continue;
      const cur = salesByStore.get(s.store);
      if (cur) cur.units += si.qty;
    }

    const rows = stores.map((st) => {
      const perf = salesByStore.get(st.id) ?? { revenue: 0, profit: 0, units: 0 };
      const placedUnits = batches
        .filter((b) => b.store === st.id && b.status === 'active' && b.remaining_qty > 0)
        .reduce((sum, b) => sum + b.remaining_qty, 0);
      return {
        store: st,
        revenue: perf.revenue,
        profit: perf.profit,
        units: perf.units,
        placedUnits,
      };
    });

    return rows.sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }, [stores, sales, saleItems, batches]);

  const maxStoreRev = Math.max(1, ...storePerformance.map((r) => r.revenue));

  const expiryTimeline = useMemo(() => {
    return batches
      .filter((b) => b.status === 'active' && b.remaining_qty > 0 && b.expiry_date)
      .map((b) => {
        const product = productsById.get(b.product);
        const info = getExpiryUrgency(b.expiry_date, thresholds);
        const clearance = product ? suggestClearancePrice(product, b, thresholds) : null;
        return { batch: b, product, ...info, clearance };
      })
      .filter((r) => r.days !== null && r.days <= thresholds.warn30)
      .sort((a, b) => (a.days ?? 999) - (b.days ?? 999))
      .slice(0, 8);
  }, [batches, productsById, thresholds]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            Operations overview
          </h1>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Live cold-chain inventory, partner consignment, and 30-day performance
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('pos')}
            className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            New direct sale
          </button>
          <button
            type="button"
            onClick={() => onNavigate('optimizer')}
            className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition-colors"
          >
            Restock optimizer
          </button>
        </div>
      </div>

      {/* Unified Cold-Chain Operational Ledger Strip — replaces generic equal stat cards */}
      <div className="grid grid-cols-2 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        <div className="p-5">
          <div className="text-xs text-[var(--text-secondary)]">30-day net profit</div>
          <div className="mt-1.5 font-mono-num text-2xl font-semibold text-[var(--text-primary)]">
            {formatPhp(kpis.profit30d)}
          </div>
          <div className="mt-1 font-mono-num text-xs text-[var(--text-muted)]">
            Revenue {formatPhp(kpis.revenue30d)}
          </div>
        </div>

        <div className="border-l border-[var(--border)] p-5 lg:border-l-0">
          <div className="text-xs text-[var(--text-secondary)]">Main freezer cost</div>
          <div className="mt-1.5 font-mono-num text-2xl font-semibold text-[var(--text-primary)]">
            {formatPhp(kpis.mainValue)}
          </div>
          <div className="mt-1 font-mono-num text-xs text-[var(--text-muted)]">
            {products.length} catalog items
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-[var(--text-secondary)]">Placed at partner stores</div>
          <div className="mt-1.5 font-mono-num text-2xl font-semibold text-[var(--text-primary)]">
            {formatPhp(kpis.placedValue)}
          </div>
          <div className="mt-1 font-mono-num text-xs text-[var(--text-muted)]">
            {stores.length} partner {stores.length === 1 ? 'store' : 'stores'}
          </div>
        </div>

        <div className="border-l border-[var(--border)] p-5 lg:border-l-0">
          <div className="text-xs text-[var(--text-secondary)]">Near-expiry batches</div>
          <div
            className={`mt-1.5 font-mono-num text-2xl font-semibold ${
              kpis.nearExpiryCount > 0 ? 'text-[var(--warn)]' : 'text-[var(--text-primary)]'
            }`}
          >
            {kpis.nearExpiryCount}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            Within {thresholds.warn30} days (FEFO)
          </div>
        </div>
      </div>

      {/* Asymmetric grid: Wide primary chart moment + narrow store performance list */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-[var(--text-primary)]">
                Favorability ranking by product
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Composite 0–100 score combining margin, sales velocity, store sell-through, and shelf life
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('optimizer')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Optimize restock
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>

          {favorabilityChartData.length === 0 ? (
            <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] py-12 text-center">
              <Package className="h-6 w-6 text-[var(--text-muted)]" strokeWidth={1.5} />
              <p className="mt-2 text-sm text-[var(--text-secondary)]">No products in PocketBase yet</p>
              <button
                type="button"
                onClick={() => onNavigate('catalog')}
                className="mt-3 rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
              >
                Add first frozen product
              </button>
            </div>
          ) : (
            <div className="mt-4 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={favorabilityChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 20, bottom: 4, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={130}
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--surface-subtle)' }}
                    contentStyle={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '10px',
                      fontSize: '12px',
                    }}
                    formatter={(val, _name, item) => [
                      `${val}/100 (${item?.payload?.marginPct ?? 0}% margin)`,
                      item?.payload?.fullName ?? 'Score',
                    ]}
                  />
                  <Bar dataKey="favorability" radius={[0, 6, 6, 0]} barSize={18}>
                    {favorabilityChartData.map((entry, idx) => (
                      <Cell
                        key={entry.fullName}
                        fill={idx === 0 ? 'var(--accent)' : idx < 3 ? '#0ea5e9' : '#94a3b8'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Partner Store Performance ranked list */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-[var(--text-primary)]">Partner store performance</h2>
            <button
              type="button"
              onClick={() => onNavigate('stores')}
              className="text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Manage
            </button>
          </div>

          {storePerformance.length === 0 ? (
            <div className="mt-8 flex flex-col items-center justify-center py-8 text-center">
              <StoreIcon className="h-5 w-5 text-[var(--text-muted)]" strokeWidth={1.5} />
              <p className="mt-2 text-xs text-[var(--text-secondary)]">No partner stores yet</p>
              <button
                type="button"
                onClick={() => onNavigate('stores')}
                className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline"
              >
                Add partner store
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {storePerformance.map((row) => {
                const widthPct = Math.max(4, Math.round((row.revenue / maxStoreRev) * 100));
                return (
                  <div key={row.store.id} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate font-medium text-[var(--text-primary)]">
                        {row.store.name}
                      </span>
                      <span className="shrink-0 font-mono-num text-[var(--text-primary)]">
                        {formatPhp(row.revenue)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-[var(--text-muted)]">
                      <span>{row.placedUnits} placed now</span>
                      <span className="font-mono-num">Profit {formatPhp(row.profit)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* FEFO Expiry Timeline */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--text-secondary)]" strokeWidth={1.5} />
            <h2 className="text-sm font-medium text-[var(--text-primary)]">
              FEFO expiry &amp; clearance timeline
            </h2>
          </div>
          <span className="font-mono-num text-xs text-[var(--text-muted)]">
            Thresholds: {thresholds.critical7}d / {thresholds.warn14}d / {thresholds.warn30}d
          </span>
        </div>

        {expiryTimeline.length === 0 ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--surface-subtle)] px-4 py-3 text-xs text-[var(--text-secondary)]">
            <TrendingUp className="h-4 w-4 text-[var(--good)]" strokeWidth={1.5} />
            No active batches expiring within {thresholds.warn30} days.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th className="py-2 pr-3 font-medium">Product &amp; batch</th>
                  <th className="py-2 px-3 font-medium">Location</th>
                  <th className="py-2 px-3 text-right font-medium">Remaining</th>
                  <th className="py-2 px-3 font-medium">Expiry</th>
                  <th className="py-2 px-3 text-right font-medium">Clearance suggestion</th>
                  <th className="py-2 pl-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {expiryTimeline.map(({ batch, product, urgency, days, clearance }) => {
                  const dotColor =
                    urgency === 'expired' || urgency === 'critical'
                      ? 'bg-[var(--danger)]'
                      : urgency === 'warn14'
                        ? 'bg-[var(--warn)]'
                        : 'bg-[var(--accent)]';
                  const locLabel =
                    batch.location_type === 'main'
                      ? 'Main freezer'
                      : storesById.get(batch.store)?.name ?? 'Partner store';

                  return (
                    <tr
                      key={batch.id}
                      className="hover:bg-[var(--surface-subtle)] transition-colors"
                    >
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                          <div>
                            <div className="font-medium text-[var(--text-primary)]">
                              {product?.name ?? 'Unknown'}
                            </div>
                            <div className="font-mono-num text-[11px] text-[var(--text-muted)]">
                              {batch.batch_code}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)]">{locLabel}</td>
                      <td className="py-2.5 px-3 text-right font-mono-num text-[var(--text-primary)]">
                        {batch.remaining_qty} {product?.unit ?? ''}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono-num text-[var(--text-primary)]">
                          {formatDate(batch.expiry_date)}
                        </div>
                        <div
                          className={`text-[11px] font-medium ${
                            urgency === 'expired' || urgency === 'critical'
                              ? 'text-[var(--danger)]'
                              : 'text-[var(--warn)]'
                          }`}
                        >
                          {days !== null && days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num">
                        {batch.clearance_price > 0 ? (
                          <span className="text-[var(--accent)]">
                            Active: {formatPhp(batch.clearance_price)}
                          </span>
                        ) : clearance && clearance.suggestedPrice > 0 ? (
                          <span className="text-[var(--text-secondary)]">
                            {formatPhp(clearance.suggestedPrice)} (-{clearance.discountPct}%)
                          </span>
                        ) : (
                          <span className="text-[var(--danger)]">Write off</span>
                        )}
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {clearance && clearance.suggestedPrice > 0 && batch.clearance_price <= 0 && (
                            <button
                              type="button"
                              onClick={() => void updateBatchClearance(batch, clearance.suggestedPrice)}
                              className="rounded-md border border-[var(--border-strong)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
                            >
                              Apply promo
                            </button>
                          )}
                          {urgency === 'expired' && (
                            <button
                              type="button"
                              onClick={() => void writeOffBatch(batch)}
                              className="rounded-md bg-[var(--danger-subtle)] px-2 py-1 text-[11px] font-medium text-[var(--danger)] hover:opacity-80 transition-opacity"
                            >
                              Write off
                            </button>
                          )}
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
  );
}
