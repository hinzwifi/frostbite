import { db, getOrCreateDeviceId } from './db';
import {
  generateBatchCode,
  generateInternalBarcode,
  generatePbId,
  generateReceiptNo,
  todayIsoDate,
} from './format';
import { mutateLocalAndQueue } from './sync';
import type {
  AppSetting,
  Batch,
  PaymentStatus,
  PriceHistory,
  Product,
  Sale,
  SaleItem,
  StockMovement,
  Store,
  StorePriceOverride,
} from '../types/models';

export async function saveProduct(
  input: Omit<Product, 'id' | 'created' | 'updated'> & { id?: string },
  priceNote = ''
): Promise<Product> {
  const now = new Date().toISOString();
  const isEdit = Boolean(input.id);
  const existing = input.id ? await db.products.get(input.id) : undefined;
  const id = input.id ?? generatePbId();

  const product: Product = {
    ...input,
    id,
    barcode: input.barcode.trim() || generateInternalBarcode(),
    sku: input.sku.trim() || `SKU-${id.slice(0, 6).toUpperCase()}`,
    created: existing?.created ?? now,
    updated: now,
  };

  await mutateLocalAndQueue('products', isEdit ? 'update' : 'create', id, product);

  const priceChanged =
    !existing ||
    existing.buy_price !== product.buy_price ||
    existing.srp_price !== product.srp_price ||
    existing.wholesale_price !== product.wholesale_price;

  if (priceChanged) {
    const ph: PriceHistory = {
      id: generatePbId(),
      product: id,
      buy_price: product.buy_price,
      srp_price: product.srp_price,
      wholesale_price: product.wholesale_price,
      recorded_at: now,
      note: priceNote || (existing ? 'Price updated' : 'Initial price'),
      created: now,
      updated: now,
    };
    await mutateLocalAndQueue('price_history', 'create', ph.id, ph);
  }

  return product;
}

export async function deleteProduct(id: string): Promise<void> {
  await mutateLocalAndQueue('products', 'delete', id);
}

export async function receiveBatch(params: {
  productId: string;
  qty: number;
  buyPrice: number;
  expiryDate: string;
  batchCode?: string;
  note?: string;
  updateProductBuyPrice?: boolean;
}): Promise<Batch> {
  const now = new Date().toISOString();
  const deviceId = await getOrCreateDeviceId();
  const batchId = generatePbId();

  const batch: Batch = {
    id: batchId,
    product: params.productId,
    batch_code: params.batchCode?.trim() || generateBatchCode(),
    location_type: 'main',
    store: '',
    buy_price: params.buyPrice,
    initial_qty: params.qty,
    remaining_qty: params.qty,
    received_at: todayIsoDate(),
    expiry_date: params.expiryDate,
    clearance_price: 0,
    status: 'active',
    created: now,
    updated: now,
  };

  await mutateLocalAndQueue('batches', 'create', batch.id, batch);

  const mov: StockMovement = {
    id: generatePbId(),
    product: params.productId,
    batch: batch.id,
    store: '',
    movement_type: 'receive',
    qty_delta: params.qty,
    unit_cost: params.buyPrice,
    reference_id: batch.batch_code,
    device_id: deviceId,
    client_op_id: `op_${generatePbId()}`,
    occurred_at: now,
    note: params.note || `Received batch ${batch.batch_code}`,
    created: now,
    updated: now,
  };
  await mutateLocalAndQueue('stock_movements', 'create', mov.id, mov);

  if (params.updateProductBuyPrice) {
    const product = await db.products.get(params.productId);
    if (product && product.buy_price !== params.buyPrice) {
      await saveProduct({ ...product, buy_price: params.buyPrice }, `Restock batch ${batch.batch_code}`);
    }
  }

  return batch;
}

/** FEFO (First Expired, First Out) allocation from main freezer batches */
async function deductFEFOFromMain(
  productId: string,
  qtyNeeded: number
): Promise<Array<{ batch: Batch; qtyTaken: number }>> {
  const activeBatches = (
    await db.batches
      .where('product')
      .equals(productId)
      .filter((b) => b.location_type === 'main' && b.status === 'active' && b.remaining_qty > 0)
      .toArray()
  ).sort((a, b) => {
    const da = a.expiry_date || '9999-12-31';
    const dbDate = b.expiry_date || '9999-12-31';
    return da.localeCompare(dbDate);
  });

  let remaining = qtyNeeded;
  const allocations: Array<{ batch: Batch; qtyTaken: number }> = [];
  const now = new Date().toISOString();

  for (const b of activeBatches) {
    if (remaining <= 0) break;
    const take = Math.min(b.remaining_qty, remaining);
    const nextQty = Number((b.remaining_qty - take).toFixed(4));
    const updatedBatch: Batch = {
      ...b,
      remaining_qty: nextQty,
      status: nextQty <= 0 ? 'depleted' : 'active',
      updated: now,
    };
    await mutateLocalAndQueue('batches', 'update', updatedBatch.id, updatedBatch);
    allocations.push({ batch: updatedBatch, qtyTaken: take });
    remaining = Number((remaining - take).toFixed(4));
  }

  return allocations;
}

/** Place stock from main freezer to a partner store (consignment placement, FEFO-tracked) */
export async function placeStockToStore(params: {
  storeId: string;
  items: Array<{ productId: string; qty: number }>;
  note?: string;
}): Promise<Batch[]> {
  const now = new Date().toISOString();
  const deviceId = await getOrCreateDeviceId();
  const createdStoreBatches: Batch[] = [];

  for (const item of params.items) {
    if (item.qty <= 0) continue;
    const product = await db.products.get(item.productId);
    if (!product) continue;

    const allocations = await deductFEFOFromMain(item.productId, item.qty);
    let placedTotal = 0;

    for (const { batch, qtyTaken } of allocations) {
      placedTotal += qtyTaken;
      const storeBatch: Batch = {
        id: generatePbId(),
        product: item.productId,
        batch_code: `${batch.batch_code}-S`,
        location_type: 'store',
        store: params.storeId,
        buy_price: batch.buy_price,
        initial_qty: qtyTaken,
        remaining_qty: qtyTaken,
        received_at: todayIsoDate(),
        expiry_date: batch.expiry_date,
        clearance_price: batch.clearance_price,
        status: 'active',
        created: now,
        updated: now,
      };
      await mutateLocalAndQueue('batches', 'create', storeBatch.id, storeBatch);
      createdStoreBatches.push(storeBatch);

      const mov: StockMovement = {
        id: generatePbId(),
        product: item.productId,
        batch: storeBatch.id,
        store: params.storeId,
        movement_type: 'place_to_store',
        qty_delta: qtyTaken,
        unit_cost: batch.buy_price,
        reference_id: batch.batch_code,
        device_id: deviceId,
        client_op_id: `op_${generatePbId()}`,
        occurred_at: now,
        note: params.note || `Placed ${qtyTaken} ${product.unit} to partner store`,
        created: now,
        updated: now,
      };
      await mutateLocalAndQueue('stock_movements', 'create', mov.id, mov);
    }

    // If main freezer didn't have enough tracked batches, still allow placement using current buy price
    const shortfall = Number((item.qty - placedTotal).toFixed(4));
    if (shortfall > 0) {
      const storeBatch: Batch = {
        id: generatePbId(),
        product: item.productId,
        batch_code: generateBatchCode(),
        location_type: 'store',
        store: params.storeId,
        buy_price: product.buy_price,
        initial_qty: shortfall,
        remaining_qty: shortfall,
        received_at: todayIsoDate(),
        expiry_date: '',
        clearance_price: 0,
        status: 'active',
        created: now,
        updated: now,
      };
      await mutateLocalAndQueue('batches', 'create', storeBatch.id, storeBatch);
      createdStoreBatches.push(storeBatch);

      const mov: StockMovement = {
        id: generatePbId(),
        product: item.productId,
        batch: storeBatch.id,
        store: params.storeId,
        movement_type: 'place_to_store',
        qty_delta: shortfall,
        unit_cost: product.buy_price,
        reference_id: storeBatch.batch_code,
        device_id: deviceId,
        client_op_id: `op_${generatePbId()}`,
        occurred_at: now,
        note: params.note || `Direct placement to store`,
        created: now,
        updated: now,
      };
      await mutateLocalAndQueue('stock_movements', 'create', mov.id, mov);
    }
  }

  return createdStoreBatches;
}

/** Record a direct Retail or Wholesale sale from main freezer */
export async function recordDirectSale(params: {
  saleType: 'retail' | 'wholesale';
  storeId?: string;
  items: Array<{ productId: string; qty: number; unitPrice: number }>;
  amountPaid: number;
  paymentStatus: PaymentStatus;
  notes?: string;
}): Promise<{ sale: Sale; saleItems: SaleItem[] }> {
  const now = new Date().toISOString();
  const deviceId = await getOrCreateDeviceId();
  const saleId = generatePbId();
  const receiptNo = generateReceiptNo(params.saleType === 'wholesale' ? 'WS' : 'RT');

  let totalRevenue = 0;
  let totalCost = 0;
  const createdItems: SaleItem[] = [];

  for (const item of params.items) {
    if (item.qty <= 0) continue;
    const product = await db.products.get(item.productId);
    if (!product) continue;

    const allocations = await deductFEFOFromMain(item.productId, item.qty);
    let accounted = 0;

    for (const { batch, qtyTaken } of allocations) {
      accounted += qtyTaken;
      const lineRev = Number((qtyTaken * item.unitPrice).toFixed(2));
      const lineCost = Number((qtyTaken * batch.buy_price).toFixed(2));
      const lineProfit = Number((lineRev - lineCost).toFixed(2));
      totalRevenue += lineRev;
      totalCost += lineCost;

      const si: SaleItem = {
        id: generatePbId(),
        sale: saleId,
        product: item.productId,
        batch: batch.id,
        qty: qtyTaken,
        unit_price: item.unitPrice,
        buy_price: batch.buy_price,
        store_cut_per_unit: 0,
        line_revenue: lineRev,
        line_profit: lineProfit,
        created: now,
        updated: now,
      };
      createdItems.push(si);

      const mov: StockMovement = {
        id: generatePbId(),
        product: item.productId,
        batch: batch.id,
        store: params.storeId || '',
        movement_type: 'sale_direct',
        qty_delta: -qtyTaken,
        unit_cost: batch.buy_price,
        reference_id: receiptNo,
        device_id: deviceId,
        client_op_id: `op_${generatePbId()}`,
        occurred_at: now,
        note: `${params.saleType} sale ${receiptNo}`,
        created: now,
        updated: now,
      };
      await mutateLocalAndQueue('stock_movements', 'create', mov.id, mov);
    }

    const remainder = Number((item.qty - accounted).toFixed(4));
    if (remainder > 0) {
      const lineRev = Number((remainder * item.unitPrice).toFixed(2));
      const lineCost = Number((remainder * product.buy_price).toFixed(2));
      const lineProfit = Number((lineRev - lineCost).toFixed(2));
      totalRevenue += lineRev;
      totalCost += lineCost;

      const si: SaleItem = {
        id: generatePbId(),
        sale: saleId,
        product: item.productId,
        batch: '',
        qty: remainder,
        unit_price: item.unitPrice,
        buy_price: product.buy_price,
        store_cut_per_unit: 0,
        line_revenue: lineRev,
        line_profit: lineProfit,
        created: now,
        updated: now,
      };
      createdItems.push(si);
    }
  }

  const sale: Sale = {
    id: saleId,
    sale_type: params.saleType,
    store: params.storeId || '',
    receipt_no: receiptNo,
    sold_at: now,
    total_revenue: Number(totalRevenue.toFixed(2)),
    total_cost: Number(totalCost.toFixed(2)),
    total_store_cut: 0,
    total_profit: Number((totalRevenue - totalCost).toFixed(2)),
    amount_paid: params.amountPaid,
    payment_status: params.paymentStatus,
    notes: params.notes || '',
    created: now,
    updated: now,
  };

  await mutateLocalAndQueue('sales', 'create', sale.id, sale);
  for (const si of createdItems) {
    await mutateLocalAndQueue('sale_items', 'create', si.id, si);
  }

  return { sale, saleItems: createdItems };
}

/**
 * Consignment Store Visit Reconciliation:
 * User counts remaining stock at a partner store -> auto-calculates sold qty,
 * store commission cut (override -> product default -> store default -> SRP - Wholesale),
 * cash remittance due to owner, and optionally drops off fresh FEFO restock.
 */
export async function reconcileStoreVisit(params: {
  store: Store;
  counts: Array<{
    batch: Batch;
    product: Product;
    countedRemaining: number;
    sellPrice: number;
    storeCutPerUnit: number;
  }>;
  amountCollected: number;
  paymentStatus: PaymentStatus;
  notes?: string;
}): Promise<{ sale: Sale; saleItems: SaleItem[] }> {
  const now = new Date().toISOString();
  const deviceId = await getOrCreateDeviceId();
  const saleId = generatePbId();
  const receiptNo = generateReceiptNo('CS');

  let totalOwnerRevenue = 0;
  let totalCost = 0;
  let totalStoreCut = 0;
  const createdItems: SaleItem[] = [];

  for (const row of params.counts) {
    const prevQty = row.batch.remaining_qty;
    const clampedRemaining = Math.max(0, Math.min(prevQty, row.countedRemaining));
    const soldQty = Number((prevQty - clampedRemaining).toFixed(4));

    // Update store batch remaining count
    const updatedBatch: Batch = {
      ...row.batch,
      remaining_qty: clampedRemaining,
      status: clampedRemaining <= 0 ? 'depleted' : 'active',
      updated: now,
    };
    await mutateLocalAndQueue('batches', 'update', updatedBatch.id, updatedBatch);

    if (soldQty <= 0) continue;

    const ownerUnitRev = Math.max(0, Number((row.sellPrice - row.storeCutPerUnit).toFixed(2)));
    const lineRev = Number((soldQty * ownerUnitRev).toFixed(2));
    const lineCost = Number((soldQty * row.batch.buy_price).toFixed(2));
    const lineCut = Number((soldQty * row.storeCutPerUnit).toFixed(2));
    const lineProfit = Number((lineRev - lineCost).toFixed(2));

    totalOwnerRevenue += lineRev;
    totalCost += lineCost;
    totalStoreCut += lineCut;

    const si: SaleItem = {
      id: generatePbId(),
      sale: saleId,
      product: row.product.id,
      batch: row.batch.id,
      qty: soldQty,
      unit_price: row.sellPrice,
      buy_price: row.batch.buy_price,
      store_cut_per_unit: row.storeCutPerUnit,
      line_revenue: lineRev,
      line_profit: lineProfit,
      created: now,
      updated: now,
    };
    createdItems.push(si);

    const mov: StockMovement = {
      id: generatePbId(),
      product: row.product.id,
      batch: row.batch.id,
      store: params.store.id,
      movement_type: 'consignment_sold',
      qty_delta: -soldQty,
      unit_cost: row.batch.buy_price,
      reference_id: receiptNo,
      device_id: deviceId,
      client_op_id: `op_${generatePbId()}`,
      occurred_at: now,
      note: `Consignment settlement at ${params.store.name}`,
      created: now,
      updated: now,
    };
    await mutateLocalAndQueue('stock_movements', 'create', mov.id, mov);
  }

  const sale: Sale = {
    id: saleId,
    sale_type: 'consignment_settlement',
    store: params.store.id,
    receipt_no: receiptNo,
    sold_at: now,
    total_revenue: Number(totalOwnerRevenue.toFixed(2)),
    total_cost: Number(totalCost.toFixed(2)),
    total_store_cut: Number(totalStoreCut.toFixed(2)),
    total_profit: Number((totalOwnerRevenue - totalCost).toFixed(2)),
    amount_paid: params.amountCollected,
    payment_status: params.paymentStatus,
    notes: params.notes || '',
    created: now,
    updated: now,
  };

  await mutateLocalAndQueue('sales', 'create', sale.id, sale);
  for (const si of createdItems) {
    await mutateLocalAndQueue('sale_items', 'create', si.id, si);
  }

  const updatedStore: Store = {
    ...params.store,
    last_visit_at: now,
    updated: now,
  };
  await mutateLocalAndQueue('stores', 'update', updatedStore.id, updatedStore);

  return { sale, saleItems: createdItems };
}

export async function writeOffBatch(batch: Batch, reason = 'Expired stock written off'): Promise<void> {
  const now = new Date().toISOString();
  const deviceId = await getOrCreateDeviceId();
  const lostQty = batch.remaining_qty;

  const updated: Batch = {
    ...batch,
    remaining_qty: 0,
    status: 'written_off',
    updated: now,
  };
  await mutateLocalAndQueue('batches', 'update', updated.id, updated);

  if (lostQty > 0) {
    const mov: StockMovement = {
      id: generatePbId(),
      product: batch.product,
      batch: batch.id,
      store: batch.store || '',
      movement_type: 'spoilage',
      qty_delta: -lostQty,
      unit_cost: batch.buy_price,
      reference_id: batch.batch_code,
      device_id: deviceId,
      client_op_id: `op_${generatePbId()}`,
      occurred_at: now,
      note: reason,
      created: now,
      updated: now,
    };
    await mutateLocalAndQueue('stock_movements', 'create', mov.id, mov);
  }
}

export async function updateBatchClearance(batch: Batch, clearancePrice: number): Promise<void> {
  const updated: Batch = {
    ...batch,
    clearance_price: clearancePrice,
    updated: new Date().toISOString(),
  };
  await mutateLocalAndQueue('batches', 'update', updated.id, updated);
}

export async function updateBatch(
  batch: Batch,
  patch: Partial<Pick<Batch, 'remaining_qty' | 'buy_price' | 'expiry_date' | 'clearance_price' | 'batch_code' | 'status'>>
): Promise<void> {
  const nextQty = patch.remaining_qty ?? batch.remaining_qty;
  const updated: Batch = {
    ...batch,
    ...patch,
    status: patch.status ?? (nextQty <= 0 ? 'depleted' : 'active'),
    updated: new Date().toISOString(),
  };
  await mutateLocalAndQueue('batches', 'update', updated.id, updated);
}

export async function deleteBatch(id: string): Promise<void> {
  await mutateLocalAndQueue('batches', 'delete', id);
}

export async function deleteStoreOverride(id: string): Promise<void> {
  await mutateLocalAndQueue('store_price_overrides', 'delete', id);
}

export async function updateSalePayment(
  sale: Sale,
  amountPaid: number,
  paymentStatus: PaymentStatus,
  notes?: string
): Promise<void> {
  const updated: Sale = {
    ...sale,
    amount_paid: amountPaid,
    payment_status: paymentStatus,
    notes: notes ?? sale.notes,
    updated: new Date().toISOString(),
  };
  await mutateLocalAndQueue('sales', 'update', updated.id, updated);
}

export async function deleteSale(id: string): Promise<void> {
  await mutateLocalAndQueue('sales', 'delete', id);
}

export async function saveStore(
  input: Omit<Store, 'id' | 'created' | 'updated'> & { id?: string }
): Promise<Store> {
  const now = new Date().toISOString();
  const isEdit = Boolean(input.id);
  const existing = input.id ? await db.stores.get(input.id) : undefined;
  const id = input.id ?? generatePbId();

  const store: Store = {
    ...input,
    id,
    created: existing?.created ?? now,
    updated: now,
  };
  await mutateLocalAndQueue('stores', isEdit ? 'update' : 'create', id, store);
  return store;
}

export async function deleteStore(id: string): Promise<void> {
  await mutateLocalAndQueue('stores', 'delete', id);
}

export async function saveStoreOverride(
  input: Omit<StorePriceOverride, 'id' | 'created' | 'updated'> & { id?: string }
): Promise<StorePriceOverride> {
  const now = new Date().toISOString();
  const existing = input.id
    ? await db.store_price_overrides.get(input.id)
    : await db.store_price_overrides
        .where('[store+product]')
        .equals([input.store, input.product])
        .first();

  const id = existing?.id ?? generatePbId();
  const record: StorePriceOverride = {
    ...input,
    id,
    created: existing?.created ?? now,
    updated: now,
  };
  await mutateLocalAndQueue(
    'store_price_overrides',
    existing ? 'update' : 'create',
    id,
    record
  );
  return record;
}

export async function saveAppSetting(key: string, value: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.app_settings.where('key').equals(key).first();
  const id = existing?.id ?? generatePbId();
  const record: AppSetting = {
    id,
    key,
    value,
    created: existing?.created ?? now,
    updated: now,
  };
  await mutateLocalAndQueue('app_settings', existing ? 'update' : 'create', id, record);
}
