import { useMemo, useState } from 'react';
import { Download, TrendingDown, TrendingUp } from 'lucide-react';
import {
  DEFAULT_OPTIMIZER_WEIGHTS,
  runRestockOptimizer,
} from '../lib/algorithms';
import { exportToCsv, formatPhp, todayIsoDate } from '../lib/format';
import type { OptimizerWeights, ProductMetrics } from '../types/models';

interface Props {
  metrics: ProductMetrics[];
  defaultWeights?: OptimizerWeights;
}

const SEGMENT_COLORS = ['#0284c7', '#059669', '#d97706', '#6366f1', '#0d9488', '#64748b'];

export function OptimizerPage({ metrics, defaultWeights = DEFAULT_OPTIMIZER_WEIGHTS }: Props) {
  const [budget, setBudget] = useState('10000');
  const [horizonDays, setHorizonDays] = useState(14);

  const plan = useMemo(
    () => runRestockOptimizer(metrics, Number(budget) || 0, horizonDays),
    [metrics, budget, horizonDays]
  );

  const exportPlanCsv = () => {
    exportToCsv(
      `frostbite-restock-plan-${todayIsoDate()}.csv`,
      plan.recommendations.map((r) => ({
        product: r.product.name,
        supplier: r.product.supplier_name,
        unit: r.product.unit,
        buy_price: r.product.buy_price,
        recommended_qty: r.recommendedQty,
        estimated_cost: r.estimatedCost,
        expected_revenue: r.expectedRevenue,
        expected_profit: r.expectedProfit,
        favorability: r.metrics.favorabilityScore,
        reason: r.reason,
      }))
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            Restock optimizer &amp; demand forecast
          </h1>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Enter your purchasing budget to compute the highest-ROI frozen mix based on live margin, velocity, and store demand
          </p>
        </div>

        {plan.recommendations.length > 0 && (
          <button
            type="button"
            onClick={exportPlanCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            Export purchase order
          </button>
        )}
      </div>

      {/* Budget Input & Capital Allocation Moment */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Available restock budget (₱)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="500"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="mt-1.5 min-h-[44px] w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-base font-semibold text-[var(--text-primary)]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Forecast horizon
            </label>
            <select
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              className="mt-1.5 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)]"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>

          <div className="rounded-lg bg-[var(--surface-subtle)] p-3">
            <div className="text-xs text-[var(--text-muted)]">Allocated spend</div>
            <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--text-primary)]">
              {formatPhp(plan.totalSpend)}
            </div>
            <div className="font-mono-num text-[11px] text-[var(--text-muted)]">
              Unspent {formatPhp(plan.remainingBudget)}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--surface-subtle)] p-3">
            <div className="text-xs text-[var(--text-muted)]">Projected net profit</div>
            <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--good)]">
              {formatPhp(plan.expectedProfit)}
            </div>
            <div className="font-mono-num text-[11px] text-[var(--text-muted)]">
              Est. revenue {formatPhp(plan.expectedRevenue)}
            </div>
          </div>
        </div>

        {/* Visual capital allocation stacked bar */}
        {plan.recommendations.length > 0 && plan.totalSpend > 0 && (
          <div className="mt-5">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
              {plan.recommendations.slice(0, 6).map((r, i) => {
                const pct = (r.estimatedCost / plan.totalSpend) * 100;
                return (
                  <div
                    key={r.product.id}
                    style={{
                      width: `${pct}%`,
                      backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                    }}
                    title={`${r.product.name}: ${formatPhp(r.estimatedCost)} (${Math.round(pct)}%)`}
                  />
                );
              })}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
              {plan.recommendations.slice(0, 6).map((r, i) => (
                <div key={r.product.id} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
                  />
                  <span>{r.product.name}</span>
                  <span className="font-mono-num text-[var(--text-muted)]">
                    {Math.round((r.estimatedCost / plan.totalSpend) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommended Purchase Order */}
        <div className="mt-5">
          {plan.recommendations.length === 0 ? (
            <p className="rounded-lg bg-[var(--surface-subtle)] px-4 py-3 text-xs text-[var(--text-muted)]">
              Add products with buy prices (or increase budget) to generate a purchase plan.
            </p>
          ) : (
            <>
              {/* Mobile recommendation cards */}
              <div className="divide-y divide-[var(--border)] md:hidden">
                {plan.recommendations.map((r) => (
                  <div key={r.product.id} className="flex items-start justify-between gap-3 py-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text-primary)]">{r.product.name}</div>
                      <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        {r.reason} · Score {r.metrics.favorabilityScore}/100
                      </div>
                      <div className="mt-1 font-mono-num text-[11px] text-[var(--text-secondary)]">
                        Cost {formatPhp(r.estimatedCost)} · Profit{' '}
                        <span className="text-[var(--good)]">+{formatPhp(r.expectedProfit)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 rounded-lg bg-[var(--accent-subtle)] px-2.5 py-1.5 font-mono-num text-xs font-semibold text-[var(--accent)]">
                      +{r.recommendedQty} {r.product.unit}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop recommendation table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 px-3 text-right font-medium">Favorability</th>
                  <th className="py-2 px-3 text-right font-medium">Main stock</th>
                  <th className="py-2 px-3 text-right font-medium">Buy qty</th>
                  <th className="py-2 px-3 text-right font-medium">Est. cost</th>
                  <th className="py-2 px-3 text-right font-medium">Est. profit</th>
                  <th className="py-2 pl-3 font-medium">Signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {plan.recommendations.map((r) => (
                  <tr key={r.product.id} className="hover:bg-[var(--surface-subtle)]">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-[var(--text-primary)]">{r.product.name}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {r.product.supplier_name || 'Primary supplier'} · {formatPhp(r.product.buy_price)}/
                        {r.product.unit}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num font-medium">
                      {r.metrics.favorabilityScore}/100
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num text-[var(--text-secondary)]">
                      {r.metrics.mainQty} {r.product.unit}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-[var(--accent)]">
                      +{r.recommendedQty} {r.product.unit}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num">{formatPhp(r.estimatedCost)}</td>
                    <td className="py-2.5 px-3 text-right font-mono-num text-[var(--good)]">
                      {formatPhp(r.expectedProfit)}
                    </td>
                    <td className="py-2.5 pl-3 text-[var(--text-secondary)]">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Full Forecast & Statistical Telemetry Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-[var(--text-primary)]">
              Demand forecast &amp; price trend telemetry
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Weighted moving average + exponential smoothing (α=0.35) · Weights:{' '}
              {Math.round(defaultWeights.margin * 100)}% margin, {Math.round(defaultWeights.velocity * 100)}% velocity,{' '}
              {Math.round(defaultWeights.sellThrough * 100)}% sell-through, {Math.round(defaultWeights.shelfLife * 100)}% shelf life
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th className="py-2 pr-3 font-medium">Product</th>
                <th className="py-2 px-3 text-right font-medium">7d / 14d / 30d</th>
                <th className="py-2 px-3 text-right font-medium">Stockout in</th>
                <th className="py-2 px-3 text-right font-medium">Sell-through</th>
                <th className="py-2 px-3 text-right font-medium">Buy trend</th>
                <th className="py-2 pl-3 text-right font-medium">Favorability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {[...metrics]
                .sort((a, b) => b.favorabilityScore - a.favorabilityScore)
                .map((m) => (
                  <tr key={m.product.id} className="hover:bg-[var(--surface-subtle)]">
                    <td className="py-2.5 pr-3 font-medium text-[var(--text-primary)]">
                      {m.product.name}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num text-[var(--text-secondary)]">
                      {m.forecast7d} / {m.forecast14d} / {m.forecast30d}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num">
                      {m.daysUntilStockout === null ? (
                        <span className="text-[var(--text-muted)]">—</span>
                      ) : (
                        <span
                          className={
                            m.daysUntilStockout <= 5 ? 'font-medium text-[var(--danger)]' : ''
                          }
                        >
                          {m.daysUntilStockout}d
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num">{m.sellThroughRate}%</td>
                    <td className="py-2.5 px-3 text-right font-mono-num">
                      {m.priceTrend === 'spiking' ? (
                        <span className="inline-flex items-center gap-1 text-[var(--danger)]">
                          <TrendingUp className="h-3 w-3" strokeWidth={1.5} />+{m.priceTrendPct}%
                        </span>
                      ) : m.priceTrend === 'dipping' ? (
                        <span className="inline-flex items-center gap-1 text-[var(--good)]">
                          <TrendingDown className="h-3 w-3" strokeWidth={1.5} />
                          {m.priceTrendPct}%
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">Stable</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono-num font-semibold text-[var(--text-primary)]">
                      {m.favorabilityScore}/100
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
