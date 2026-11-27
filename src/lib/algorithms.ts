import { daysUntil } from './format';
import type {
  Batch,
  ExpiryThresholds,
  OptimizerWeights,
  PriceHistory,
  Product,
  ProductMetrics,
  RestockRecommendation,
  Sale,
  SaleItem,
  StockMovement,
  Store,
  StorePriceOverride,
} from '../types/models';

export const DEFAULT_EXPIRY_THRESHOLDS: ExpiryThresholds = {
  warn30: 30,
  warn14: 14,
  critical7: 7,
};

export const DEFAULT_OPTIMIZER_WEIGHTS: OptimizerWeights = {
  margin: 0.30,
  velocity: 0.30,
  sellThrough: 0.25,
  shelfLife: 0.15,
};

export type ExpiryUrgency = 'expired' | 'critical' | 'warn14' | 'warn30' | 'ok' | 'none';

export function getExpiryUrgency(
  expiryDate?: string | null,
  thresholds: ExpiryThresholds = DEFAULT_EXPIRY_THRESHOLDS
): { urgency: ExpiryUrgency; days: number | null } {
  const days = daysUntil(expiryDate);
  if (days === null) return { urgency: 'none', days: null };
  if (days < 0) return { urgency: 'expired', days };
  if (days <= thresholds.critical7) return { urgency: 'critical', days };
  if (days <= thresholds.warn14) return { urgency: 'warn14', days };
  if (days <= thresholds.warn30) return { urgency: 'warn30', days };
  return { urgency: 'ok', days };
}

/** Suggests a clearance/promo price to recover capital before spoilage */
export function suggestClearancePrice(
  product: Product,
  batch: Batch,
  thresholds: ExpiryThresholds = DEFAULT_EXPIRY_THRESHOLDS
): { suggestedPrice: number; discountPct: number; label: string } | null {
  const { urgency, days } = getExpiryUrgency(batch.expiry_date, thresholds);
  if (days === null || urgency === 'ok' || urgency === 'none') return null;

  const base = product.srp_price > 0 ? product.srp_price : product.wholesale_price;
  const cost = batch.buy_price > 0 ? batch.buy_price : product.buy_price;
  if (base <= 0) return null;

  if (urgency === 'expired') {
    return { suggestedPrice: 0, discountPct: 100, label: 'Write off (expired)' };
  }
  if (urgency === 'critical') {
    // At or just above cost (max 5% over cost, or 70% of SRP) to liquidate fast
    const target = Math.max(cost * 1.02, base * 0.72);
    const rounded = Math.round(Math.min(base, target));
    const disc = Math.max(0, Math.round(((base - rounded) / base) * 100));
    return { suggestedPrice: rounded, discountPct: disc, label: `Critical (${days}d left)` };
  }
  if (urgency === 'warn14') {
    const target = Math.max(cost * 1.08, base * 0.85);
    const rounded = Math.round(Math.min(base, target));
    const disc = Math.max(0, Math.round(((base - rounded) / base) * 100));
    return { suggestedPrice: rounded, discountPct: disc, label: `Promo (${days}d left)` };
  }
  // warn30
  const target = Math.max(cost * 1.12, base * 0.92);
  const rounded = Math.round(Math.min(base, target));
  const disc = Math.max(0, Math.round(((base - rounded) / base) * 100));
  return { suggestedPrice: rounded, discountPct: disc, label: `Watch (${days}d left)` };
}

/** Resolves effective store commission cut per unit for consignment */
export function resolveStoreCut(
  product: Product,
  store?: Store,
  override?: StorePriceOverride
): number {
  if (override && override.custom_store_cut > 0) return override.custom_store_cut;
  if (product.default_store_cut > 0) return product.default_store_cut;
  if (store && store.default_cut_per_unit > 0) return store.default_cut_per_unit;
  if (product.srp_price > product.wholesale_price && product.wholesale_price > 0) {
    return Number((product.srp_price - product.wholesale_price).toFixed(2));
  }
  return 5;
}

/** Resolves effective wholesale price for a given store */
export function resolveWholesalePrice(
  product: Product,
  override?: StorePriceOverride
): number {
  if (override && override.custom_wholesale_price > 0) return override.custom_wholesale_price;
  return product.wholesale_price > 0 ? product.wholesale_price : product.srp_price;
}

/**
 * Single Exponential Smoothing (SES) blended with Weighted Moving Average (WMA)
 * over the last 30 days of daily demand. Works 100% offline.
 */
export function forecastDailyDemand(dailySeries: number[], alpha = 0.35): number {
  if (dailySeries.length === 0) return 0;
  const nonZero = dailySeries.some((v) => v > 0);
  if (!nonZero) return 0;

  // Single exponential smoothing
  let ses = dailySeries[0];
  for (let i = 1; i < dailySeries.length; i++) {
    ses = alpha * dailySeries[i] + (1 - alpha) * ses;
  }

  // Linearly weighted moving average (recent days weigh more)
  let weightSum = 0;
  let weightedTotal = 0;
  for (let i = 0; i < dailySeries.length; i++) {
    const w = i + 1;
    weightedTotal += dailySeries[i] * w;
    weightSum += w;
  }
  const wma = weightSum > 0 ? weightedTotal / weightSum : 0;

  return Math.max(0, Number((0.55 * ses + 0.45 * wma).toFixed(3)));
}

function buildDailySeries(
  saleItems: SaleItem[],
  salesById: Map<string, Sale>,
  days = 30
): number[] {
  const series = new Array<number>(days).fill(0);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  for (const si of saleItems) {
    const sale = salesById.get(si.sale);
    if (!sale) continue;
    const d = new Date(sale.sold_at);
    if (Number.isNaN(d.getTime())) continue;
    const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.floor((todayStart - itemDay) / 86_400_000);
    if (diffDays >= 0 && diffDays < days) {
      series[days - 1 - diffDays] += si.qty;
    }
  }
  return series;
}

export function detectBuyPriceTrend(history: PriceHistory[]): {
  trend: 'spiking' | 'dipping' | 'stable';
  pct: number;
} {
  if (history.length < 2) return { trend: 'stable', pct: 0 };
  const sorted = [...history].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const latest = sorted[sorted.length - 1].buy_price;
  const prior = sorted.slice(0, -1);
  const avgPrior = prior.reduce((s, r) => s + r.buy_price, 0) / prior.length;
  if (avgPrior <= 0) return { trend: 'stable', pct: 0 };
  const pct = Number((((latest - avgPrior) / avgPrior) * 100).toFixed(1));
  if (pct >= 4) return { trend: 'spiking', pct };
  if (pct <= -4) return { trend: 'dipping', pct };
  return { trend: 'stable', pct };
}

export function computeAllProductMetrics(params: {
  products: Product[];
  batches: Batch[];
  sales: Sale[];
  saleItems: SaleItem[];
  priceHistory: PriceHistory[];
  movements: StockMovement[];
  weights?: OptimizerWeights;
}): ProductMetrics[] {
  const weights = params.weights ?? DEFAULT_OPTIMIZER_WEIGHTS;
  const salesById = new Map(params.sales.map((s) => [s.id, s]));

  // Pre-group for O(N)
  const batchesByProduct = new Map<string, Batch[]>();
  for (const b of params.batches) {
    const arr = batchesByProduct.get(b.product) ?? [];
    arr.push(b);
    batchesByProduct.set(b.product, arr);
  }

  const itemsByProduct = new Map<string, SaleItem[]>();
  for (const si of params.saleItems) {
    const arr = itemsByProduct.get(si.product) ?? [];
    arr.push(si);
    itemsByProduct.set(si.product, arr);
  }

  const phByProduct = new Map<string, PriceHistory[]>();
  for (const ph of params.priceHistory) {
    const arr = phByProduct.get(ph.product) ?? [];
    arr.push(ph);
    phByProduct.set(ph.product, arr);
  }

  const movByProduct = new Map<string, StockMovement[]>();
  for (const m of params.movements) {
    const arr = movByProduct.get(m.product) ?? [];
    arr.push(m);
    movByProduct.set(m.product, arr);
  }

  // First pass: raw stats so we can normalize velocity across catalog
  const prelim = params.products.map((product) => {
    const pBatches = batchesByProduct.get(product.id) ?? [];
    const activeBatches = pBatches.filter((b) => b.status === 'active' && b.remaining_qty > 0);
    const mainQty = activeBatches
      .filter((b) => b.location_type === 'main')
      .reduce((s, b) => s + b.remaining_qty, 0);
    const storeQty = activeBatches
      .filter((b) => b.location_type === 'store')
      .reduce((s, b) => s + b.remaining_qty, 0);
    const totalQty = mainQty + storeQty;

    const expiryCandidates = activeBatches
      .map((b) => ({ date: b.expiry_date, days: daysUntil(b.expiry_date) }))
      .filter((x): x is { date: string; days: number } => x.days !== null)
      .sort((a, b) => a.days - b.days);

    const nearestExpiryDate = expiryCandidates[0]?.date ?? null;
    const nearestExpiryDays = expiryCandidates[0]?.days ?? null;

    const srpMarginPhp = Number((product.srp_price - product.buy_price).toFixed(2));
    const srpMarginPct =
      product.srp_price > 0 ? Number(((srpMarginPhp / product.srp_price) * 100).toFixed(1)) : 0;
    const wholesaleMarginPhp = Number((product.wholesale_price - product.buy_price).toFixed(2));
    const wholesaleMarginPct =
      product.wholesale_price > 0
        ? Number(((wholesaleMarginPhp / product.wholesale_price) * 100).toFixed(1))
        : 0;

    const pItems = itemsByProduct.get(product.id) ?? [];
    const dailySeries = buildDailySeries(pItems, salesById, 30);
    const dailyVelocity = forecastDailyDemand(dailySeries);
    const totalUnitsSold30d = dailySeries.reduce((s, v) => s + v, 0);

    const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
    const totalProfit30d = pItems.reduce((sum, si) => {
      const sale = salesById.get(si.sale);
      if (!sale) return sum;
      if (new Date(sale.sold_at).getTime() >= thirtyDaysAgo) {
        return sum + si.line_profit;
      }
      return sum;
    }, 0);

    const pMovs = movByProduct.get(product.id) ?? [];
    const placedQty = pMovs
      .filter((m) => m.movement_type === 'place_to_store')
      .reduce((s, m) => s + Math.abs(m.qty_delta), 0);
    const soldConsignQty = pMovs
      .filter((m) => m.movement_type === 'consignment_sold')
      .reduce((s, m) => s + Math.abs(m.qty_delta), 0);
    const receivedQty = pMovs
      .filter((m) => m.movement_type === 'receive')
      .reduce((s, m) => s + Math.abs(m.qty_delta), 0);
    const spoiledQty = pMovs
      .filter((m) => m.movement_type === 'spoilage')
      .reduce((s, m) => s + Math.abs(m.qty_delta), 0);

    const sellThroughRate =
      placedQty > 0
        ? Math.min(1, soldConsignQty / placedQty)
        : receivedQty > 0
          ? Math.min(1, totalUnitsSold30d / receivedQty)
          : 0.5;
    const spoilageRate = receivedQty > 0 ? Math.min(1, spoiledQty / receivedQty) : 0;

    const { trend: priceTrend, pct: priceTrendPct } = detectBuyPriceTrend(
      phByProduct.get(product.id) ?? []
    );

    return {
      product,
      mainQty,
      storeQty,
      totalQty,
      srpMarginPhp,
      srpMarginPct,
      wholesaleMarginPhp,
      wholesaleMarginPct,
      dailyVelocity,
      forecast7d: Number((dailyVelocity * 7).toFixed(1)),
      forecast14d: Number((dailyVelocity * 14).toFixed(1)),
      forecast30d: Number((dailyVelocity * 30).toFixed(1)),
      daysUntilStockout:
        dailyVelocity > 0 ? Math.max(0, Math.round(totalQty / dailyVelocity)) : null,
      sellThroughRate: Number((sellThroughRate * 100).toFixed(1)),
      spoilageRate: Number((spoilageRate * 100).toFixed(1)),
      priceTrend,
      priceTrendPct,
      nearestExpiryDate,
      nearestExpiryDays,
      totalUnitsSold30d,
      totalProfit30d: Number(totalProfit30d.toFixed(2)),
    };
  });

  const maxVelocity = Math.max(1, ...prelim.map((p) => p.dailyVelocity));

  return prelim.map((p) => {
    const marginNorm = Math.min(1, Math.max(0, p.srpMarginPct / 35)); // 35% margin = 1.0
    const velocityNorm = Math.min(1, p.dailyVelocity / maxVelocity);
    const sellThroughNorm = Math.min(1, p.sellThroughRate / 100);
    const shelfLifeNorm = Math.max(0, 1 - p.spoilageRate / 100);

    const rawScore =
      (marginNorm * weights.margin +
        velocityNorm * weights.velocity +
        sellThroughNorm * weights.sellThrough +
        shelfLifeNorm * weights.shelfLife) *
      100;

    const boost = Math.max(-20, Math.min(20, p.product.owner_favorability_boost || 0));
    const favorabilityScore = Math.round(Math.max(0, Math.min(100, rawScore + boost)));

    return {
      ...p,
      favorabilityScore,
    };
  });
}

/**
 * Budget-Aware Restock Optimizer:
 * Given a capital budget (in ₱), allocates exact integer quantities to restock
 * maximizing expected profit & favorability density per peso while respecting
 * 14-day demand + safety stock caps.
 */
export function runRestockOptimizer(
  metricsList: ProductMetrics[],
  budgetPhp: number,
  horizonDays = 14
): {
  recommendations: RestockRecommendation[];
  totalSpend: number;
  expectedRevenue: number;
  expectedProfit: number;
  remainingBudget: number;
} {
  const active = metricsList.filter((m) => m.product.is_active && m.product.buy_price > 0);

  // Score and determine target restock cap for each product
  const candidates = active
    .map((m) => {
      const forecastedNeed = Math.ceil(m.dailyVelocity * horizonDays * 1.15);
      const minFloor = Math.max(m.product.min_stock_level || 0, forecastedNeed);
      const deficit = Math.max(0, minFloor - m.mainQty);
      // Even for new products with 0 sales history, allow at least min_stock_level or 5 units if strong margin
      const targetCap = deficit > 0 ? deficit : m.mainQty === 0 ? Math.max(5, m.product.min_stock_level || 5) : 0;

      const unitSell = m.product.wholesale_price > 0 ? m.product.wholesale_price : m.product.srp_price;
      const unitProfit = Math.max(0, unitSell - m.product.buy_price);
      const roiPerPeso = m.product.buy_price > 0 ? unitProfit / m.product.buy_price : 0;

      // Urgency multiplier if nearing stockout
      const urgencyBoost =
        m.daysUntilStockout !== null && m.daysUntilStockout <= 5
          ? 1.35
          : m.mainQty <= (m.product.min_stock_level || 0)
            ? 1.2
            : 1.0;

      // Dipping buy price is a good moment to stock up
      const priceFactor = m.priceTrend === 'dipping' ? 1.1 : m.priceTrend === 'spiking' ? 0.92 : 1.0;

      const priorityScore = Number(
        ((m.favorabilityScore * 0.65 + roiPerPeso * 100 * 0.35) * urgencyBoost * priceFactor).toFixed(1)
      );

      let reason = `Favorability ${m.favorabilityScore}/100`;
      if (m.daysUntilStockout !== null && m.daysUntilStockout <= 5) {
        reason = `Stockout in ${m.daysUntilStockout}d · ${m.srpMarginPct}% margin`;
      } else if (m.priceTrend === 'dipping') {
        reason = `Buy cost dipped ${Math.abs(m.priceTrendPct)}% · good entry`;
      } else if (m.mainQty <= (m.product.min_stock_level || 0)) {
        reason = `Below min stock (${m.mainQty}/${m.product.min_stock_level})`;
      }

      return {
        m,
        targetCap,
        unitSell,
        unitProfit,
        priorityScore,
        reason,
      };
    })
    .filter((c) => c.targetCap > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  let remainingBudget = Math.max(0, budgetPhp);
  const recommendations: RestockRecommendation[] = [];

  // Two-pass allocation:
  // Pass 1: Cover urgent/high-priority items up to 60% of their cap (balanced diversification)
  // Pass 2: Fill remaining caps in priority order with leftover budget
  const allocated = new Map<string, number>();

  for (const passRatio of [0.6, 1.0]) {
    for (const c of candidates) {
      if (remainingBudget < c.m.product.buy_price) continue;
      const already = allocated.get(c.m.product.id) ?? 0;
      const passTarget = Math.max(1, Math.ceil(c.targetCap * passRatio));
      const wantMore = Math.max(0, passTarget - already);
      if (wantMore <= 0) continue;

      const maxAffordable = Math.floor(remainingBudget / c.m.product.buy_price);
      const take = Math.min(wantMore, maxAffordable);
      if (take > 0) {
        allocated.set(c.m.product.id, already + take);
        remainingBudget = Number((remainingBudget - take * c.m.product.buy_price).toFixed(2));
      }
    }
  }

  let totalSpend = 0;
  let expectedRevenue = 0;
  let expectedProfit = 0;

  for (const c of candidates) {
    const qty = allocated.get(c.m.product.id) ?? 0;
    if (qty <= 0) continue;
    const estCost = Number((qty * c.m.product.buy_price).toFixed(2));
    const estRev = Number((qty * c.unitSell).toFixed(2));
    const estProfit = Number((qty * c.unitProfit).toFixed(2));
    totalSpend += estCost;
    expectedRevenue += estRev;
    expectedProfit += estProfit;

    recommendations.push({
      product: c.m.product,
      metrics: c.m,
      recommendedQty: qty,
      estimatedCost: estCost,
      expectedRevenue: estRev,
      expectedProfit: estProfit,
      priorityScore: c.priorityScore,
      reason: c.reason,
    });
  }

  return {
    recommendations,
    totalSpend: Number(totalSpend.toFixed(2)),
    expectedRevenue: Number(expectedRevenue.toFixed(2)),
    expectedProfit: Number(expectedProfit.toFixed(2)),
    remainingBudget: Number(remainingBudget.toFixed(2)),
  };
}

/** Build daily sales + 14-day forecast chart series for a single product */
export function buildProductVelocityChart(
  productId: string,
  saleItems: SaleItem[],
  sales: Sale[],
  dailyForecast: number
): Array<{ date: string; actual: number | null; forecast: number | null }> {
  const salesById = new Map(sales.map((s) => [s.id, s]));
  const pItems = saleItems.filter((si) => si.product === productId);
  const past14 = buildDailySeries(pItems, salesById, 14);
  const now = new Date();
  const points: Array<{ date: string; actual: number | null; forecast: number | null }> = [];

  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (13 - i));
    const label = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    points.push({
      date: label,
      actual: past14[i],
      forecast: i === 13 ? past14[i] : null,
    });
  }

  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const label = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    points.push({
      date: label,
      actual: null,
      forecast: Number(dailyForecast.toFixed(2)),
    });
  }

  return points;
}
