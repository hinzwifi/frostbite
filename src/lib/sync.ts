import { useEffect, useState } from 'react';
import { db } from './db';
import { pb } from './pocketbase';
import type { CollectionName, OutboxOp } from '../types/models';

export const ALL_COLLECTIONS: CollectionName[] = [
  'products',
  'stores',
  'price_history',
  'batches',
  'store_price_overrides',
  'sales',
  'sale_items',
  'stock_movements',
  'app_settings',
];

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

let state: SyncState = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  pendingCount: 0,
  lastSyncedAt: null,
  lastError: null,
};

const listeners = new Set<() => void>();
let syncInFlight: Promise<void> | null = null;
let realtimeActive = false;

function emit() {
  for (const fn of listeners) fn();
}

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  emit();
}

export async function refreshPendingCount() {
  const count = await db.outbox.count();
  setState({ pendingCount: count });
}

function getTable(collection: CollectionName) {
  switch (collection) {
    case 'products': return db.products;
    case 'price_history': return db.price_history;
    case 'batches': return db.batches;
    case 'stores': return db.stores;
    case 'store_price_overrides': return db.store_price_overrides;
    case 'sales': return db.sales;
    case 'sale_items': return db.sale_items;
    case 'stock_movements': return db.stock_movements;
    case 'app_settings': return db.app_settings;
  }
}

/** Write locally to IndexedDB immediately and queue for PocketBase sync */
export async function mutateLocalAndQueue<T extends { id: string }>(
  collection: CollectionName,
  action: 'create' | 'update' | 'delete',
  recordId: string,
  record?: T
): Promise<void> {
  const table = getTable(collection);
  await db.transaction('rw', table, db.outbox, async () => {
    if (action === 'delete') {
      await table.delete(recordId);
    } else if (record) {
      await (table as unknown as { put: (item: T) => Promise<string> }).put(record);
    }

    const op: OutboxOp = {
      collection,
      recordId,
      action,
      payload: record ? (record as unknown as Record<string, unknown>) : undefined,
      createdAt: new Date().toISOString(),
      retries: 0,
    };
    await db.outbox.add(op);
  });

  await refreshPendingCount();
  if (navigator.onLine && pb.authStore.isValid) {
    void triggerSync();
  }
}

async function flushOutbox(): Promise<void> {
  const ops = await db.outbox.orderBy('id').toArray();
  for (const op of ops) {
    if (!op.id) continue;
    try {
      const col = pb.collection(op.collection);
      if (op.action === 'create' && op.payload) {
        const clean = { ...op.payload };
        delete clean.created;
        delete clean.updated;
        try {
          await col.create(clean);
        } catch (err: unknown) {
          // If record already exists (idempotent retry), fall back to update
          const status = (err as { status?: number })?.status;
          if (status === 400) {
            await col.update(op.recordId, clean);
          } else {
            throw err;
          }
        }
      } else if (op.action === 'update' && op.payload) {
        const clean = { ...op.payload };
        delete clean.created;
        delete clean.updated;
        await col.update(op.recordId, clean);
      } else if (op.action === 'delete') {
        try {
          await col.delete(op.recordId);
        } catch (err: unknown) {
          const status = (err as { status?: number })?.status;
          if (status !== 404) throw err;
        }
      }
      await db.outbox.delete(op.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      await db.outbox.update(op.id, {
        retries: op.retries + 1,
        lastError: message,
      });
      throw new Error(`${op.collection}/${op.action}: ${message}`);
    }
  }
}

async function pullAllCollections(): Promise<void> {
  for (const name of ALL_COLLECTIONS) {
    const remoteItems = await pb.collection(name).getFullList({ batch: 500 });
    const table = getTable(name);
    // Only overwrite records that do not have pending local outbox operations
    const pendingForCol = new Set(
      (await db.outbox.where('collection').equals(name).toArray()).map((o) => o.recordId)
    );

    await db.transaction('rw', table, async () => {
      const remoteIds = new Set<string>();
      for (const item of remoteItems) {
        remoteIds.add(item.id);
        if (!pendingForCol.has(item.id)) {
          await (table as { put: (r: unknown) => Promise<string> }).put(item);
        }
      }
      // Remove local records deleted remotely (unless pending locally)
      const localKeys = await table.toCollection().primaryKeys();
      for (const k of localKeys) {
        if (!remoteIds.has(k) && !pendingForCol.has(k)) {
          await table.delete(k);
        }
      }
    });
  }
}

export async function triggerSync(): Promise<void> {
  if (!navigator.onLine || !pb.authStore.isValid) {
    setState({ online: navigator.onLine });
    return;
  }
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    setState({ syncing: true, lastError: null, online: true });
    try {
      await flushOutbox();
      await pullAllCollections();
      const now = new Date().toISOString();
      await db.meta.put({ key: 'last_synced_at', value: now });
      await refreshPendingCount();
      setState({ lastSyncedAt: now, lastError: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sync error';
      setState({ lastError: message });
    } finally {
      setState({ syncing: false });
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

export async function startRealtimeSync(): Promise<void> {
  if (realtimeActive || !pb.authStore.isValid) return;
  realtimeActive = true;
  for (const name of ALL_COLLECTIONS) {
    try {
      await pb.collection(name).subscribe('*', async (e) => {
        const pending = await db.outbox
          .where('collection')
          .equals(name)
          .and((o) => o.recordId === e.record.id)
          .count();
        if (pending > 0) return;

        const table = getTable(name);
        if (e.action === 'delete') {
          await table.delete(e.record.id);
        } else {
          await (table as { put: (r: unknown) => Promise<string> }).put(e.record);
        }
      });
    } catch {
      // Realtime will retry on next reconnect/sync
    }
  }
}

export async function stopRealtimeSync(): Promise<void> {
  if (!realtimeActive) return;
  realtimeActive = false;
  for (const name of ALL_COLLECTIONS) {
    try {
      await pb.collection(name).unsubscribe('*');
    } catch {
      // Ignore cleanup errors when offline
    }
  }
}

export function initSyncListeners(): () => void {
  void (async () => {
    const last = await db.meta.get('last_synced_at');
    const count = await db.outbox.count();
    setState({
      online: navigator.onLine,
      pendingCount: count,
      lastSyncedAt: last?.value ?? null,
    });
  })();

  const onOnline = () => {
    setState({ online: true });
    if (pb.authStore.isValid) {
      void triggerSync();
      void startRealtimeSync();
    }
  };

  const onOffline = () => {
    setState({ online: false });
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

export function useSyncStatus(): SyncState & { syncNow: () => Promise<void> } {
  const [snap, setSnap] = useState<SyncState>(state);
  useEffect(() => {
    const handle = () => setSnap({ ...state });
    listeners.add(handle);
    handle();
    return () => {
      listeners.delete(handle);
    };
  }, []);

  return { ...snap, syncNow: triggerSync };
}
