export type LocationType = 'main' | 'store';
export type BatchStatus = 'active' | 'depleted' | 'expired' | 'written_off';
export type StoreMode = 'consignment' | 'wholesale' | 'hybrid';
export type SaleType = 'retail' | 'wholesale' | 'consignment_settlement';
export type PaymentStatus = 'paid' | 'partial' | 'unpaid';
export type MovementType =
  | 'receive'
  | 'place_to_store'
  | 'sale_direct'
  | 'consignment_sold'
  | 'return_from_store'
  | 'adjust'
  | 'spoilage';

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  has_barcode?: boolean;
  plu_code?: string;
  category: string;
  unit: string;
  supplier_name: string;
  buy_price: number;
  srp_price: number;
  wholesale_price: number;
  default_store_cut: number;
  min_stock_level: number;
  expiry_warn_days: number;
  owner_favorability_boost: number;
  notes: string;
  is_active: boolean;
  created?: string;
  updated?: string;
}

export interface PriceHistory {
  id: string;
  product: string;
  buy_price: number;
  srp_price: number;
  wholesale_price: number;
  recorded_at: string;
  note: string;
  created?: string;
  updated?: string;
}

export interface Batch {
  id: string;
  product: string;
  batch_code: string;
  location_type: LocationType;
  store: string; // empty string when main freezer
  buy_price: number;
  initial_qty: number;
  remaining_qty: number;
  received_at: string;
  expiry_date: string; // YYYY-MM-DD
  clearance_price: number;
  status: BatchStatus;
  created?: string;
  updated?: string;
}

export interface Store {
  id: string;
  name: string;
  contact_name: string;
  phone: string;
  address: string;
  mode: StoreMode;
  default_cut_per_unit: number;
  visit_cycle_days: number;
  last_visit_at: string;
  owner_notes: string;
  is_active: boolean;
  created?: string;
  updated?: string;
}

export interface StorePriceOverride {
  id: string;
  store: string;
  product: string;
  custom_wholesale_price: number;
  custom_store_cut: number;
  store_favorability_boost: number;
  notes: string;
  created?: string;
  updated?: string;
}

export interface Sale {
  id: string;
  sale_type: SaleType;
  store: string;
  receipt_no: string;
  sold_at: string;
  total_revenue: number;
  total_cost: number;
  total_store_cut: number;
  total_profit: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  notes: string;
  created?: string;
  updated?: string;
}

export interface SaleItem {
  id: string;
  sale: string;
  product: string;
  batch: string;
  qty: number;
  unit_price: number;
  buy_price: number;
  store_cut_per_unit: number;
  line_revenue: number;
  line_profit: number;
  created?: string;
  updated?: string;
}

export interface StockMovement {
  id: string;
  product: string;
  batch: string;
  store: string;
  movement_type: MovementType;
  qty_delta: number;
  unit_cost: number;
  reference_id: string;
  device_id: string;
  client_op_id: string;
  occurred_at: string;
  note: string;
  created?: string;
  updated?: string;
}

export interface AppSetting {
  id: string;
  key: string;
  value: Record<string, unknown>;
  created?: string;
  updated?: string;
}

export type CollectionName =
  | 'products'
  | 'price_history'
  | 'batches'
  | 'stores'
  | 'store_price_overrides'
  | 'sales'
  | 'sale_items'
  | 'stock_movements'
  | 'app_settings';

export interface OutboxOp {
  id?: number;
  collection: CollectionName;
  recordId: string;
  action: 'create' | 'update' | 'delete';
  payload?: Record<string, unknown>;
  createdAt: string;
  retries: number;
  lastError?: string;
}

export interface ExpiryThresholds {
  warn30: number;
  warn14: number;
  critical7: number;
}

export interface OptimizerWeights {
  margin: number;
  velocity: number;
  sellThrough: number;
  shelfLife: number;
}

export interface ProductMetrics {
  product: Product;
  mainQty: number;
  storeQty: number;
  totalQty: number;
  srpMarginPhp: number;
  srpMarginPct: number;
  wholesaleMarginPhp: number;
  wholesaleMarginPct: number;
  dailyVelocity: number;
  forecast7d: number;
  forecast14d: number;
  forecast30d: number;
  daysUntilStockout: number | null;
  sellThroughRate: number;
  spoilageRate: number;
  favorabilityScore: number;
  priceTrend: 'spiking' | 'dipping' | 'stable';
  priceTrendPct: number;
  nearestExpiryDate: string | null;
  nearestExpiryDays: number | null;
  totalUnitsSold30d: number;
  totalProfit30d: number;
}

export interface RestockRecommendation {
  product: Product;
  metrics: ProductMetrics;
  recommendedQty: number;
  estimatedCost: number;
  expectedRevenue: number;
  expectedProfit: number;
  priorityScore: number;
  reason: string;
}
