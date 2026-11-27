import Dexie, { type Table } from 'dexie';
import type {
  AppSetting,
  Batch,
  OutboxOp,
  PriceHistory,
  Product,
  Sale,
  SaleItem,
  StockMovement,
  Store,
  StorePriceOverride,
} from '../types/models';

export interface MetaEntry {
  key: string;
  value: string;
}

export class FrostbiteDB extends Dexie {
  products!: Table<Product, string>;
  price_history!: Table<PriceHistory, string>;
  batches!: Table<Batch, string>;
  stores!: Table<Store, string>;
  store_price_overrides!: Table<StorePriceOverride, string>;
  sales!: Table<Sale, string>;
  sale_items!: Table<SaleItem, string>;
  stock_movements!: Table<StockMovement, string>;
  app_settings!: Table<AppSetting, string>;
  outbox!: Table<OutboxOp, number>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super('frostbite_coldchain_v1');
    this.version(1).stores({
      products: 'id, barcode, name, category, is_active',
      price_history: 'id, product, recorded_at',
      batches: 'id, product, location_type, store, expiry_date, status',
      stores: 'id, name, mode, is_active',
      store_price_overrides: 'id, [store+product], store, product',
      sales: 'id, sale_type, store, sold_at, receipt_no, payment_status',
      sale_items: 'id, sale, product, batch',
      stock_movements: 'id, product, batch, store, movement_type, occurred_at, client_op_id',
      app_settings: 'id, key',
      outbox: '++id, collection, recordId, createdAt',
      meta: 'key',
    });
  }
}

export const db = new FrostbiteDB();

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await db.meta.get('device_id');
  if (existing?.value) return existing.value;
  const id = `dev_${crypto.randomUUID().slice(0, 8)}`;
  await db.meta.put({ key: 'device_id', value: id });
  return id;
}
