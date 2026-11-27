import { useMemo, useState } from 'react';
import {
  ClipboardCheck,
  PackagePlus,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { ReceiptModal } from '../components/ReceiptModal';
import { resolveStoreCut, resolveWholesalePrice } from '../lib/algorithms';
import { daysUntil, formatDate, formatPhp } from '../lib/format';
import {
  deleteStore,
  placeStockToStore,
  reconcileStoreVisit,
  saveStore,
  saveStoreOverride,
} from '../lib/inventory';
import type {
  Batch,
  PaymentStatus,
  Product,
  Sale,
  SaleItem,
  Store,
  StoreMode,
  StorePriceOverride,
} from '../types/models';

interface Props {
  stores: Store[];
  products: Product[];
  batches: Batch[];
  overrides: StorePriceOverride[];
}

const EMPTY_STORE = {
  id: '',
  name: '',
  contact_name: '',
  phone: '',
  address: '',
  mode: 'consignment' as StoreMode,
  default_cut_per_unit: '5',
  visit_cycle_days: '7',
  owner_notes: '',
  is_active: true,
};

export function StoresPage({ stores, products, batches, overrides }: Props) {
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(stores[0]?.id ?? null);
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [storeForm, setStoreForm] = useState(EMPTY_STORE);

  // Place stock modal
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeQtyMap, setPlaceQtyMap] = useState<Record<string, string>>({});

  // Consignment visit reconciliation modal
  const [visitOpen, setVisitOpen] = useState(false);
  const [remainingMap, setRemainingMap] = useState<Record<string, string>>({});
  const [amountCollected, setAmountCollected] = useState('');
  const [visitPaymentStatus, setVisitPaymentStatus] = useState<PaymentStatus>('paid');
  const [visitNotes, setVisitNotes] = useState('');

  // Custom override modal
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [ovProductId, setOvProductId] = useState('');
  const [ovWholesale, setOvWholesale] = useState('');
  const [ovCut, setOvCut] = useState('');
  const [ovBoost, setOvBoost] = useState('0');
  const [ovNotes, setOvNotes] = useState('');

  // Receipt after visit settlement
  const [receiptData, setReceiptData] = useState<{ sale: Sale; items: SaleItem[]; store: Store } | null>(
    null
  );

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const selectedStore = useMemo(
    () => stores.find((s) => s.id === selectedStoreId) ?? stores[0] ?? null,
    [stores, selectedStoreId]
  );

  const storeBatches = useMemo(() => {
    if (!selectedStore) return [];
    return batches
      .filter((b) => b.store === selectedStore.id && b.status === 'active' && b.remaining_qty > 0)
      .sort((a, b) => (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31'));
  }, [batches, selectedStore]);

  const storeOverrides = useMemo(() => {
    if (!selectedStore) return new Map<string, StorePriceOverride>();
    return new Map(
      overrides.filter((o) => o.store === selectedStore.id).map((o) => [o.product, o])
    );
  }, [overrides, selectedStore]);

  const openAddStore = () => {
    setStoreForm(EMPTY_STORE);
    setStoreModalOpen(true);
  };

  const openEditStore = (s: Store) => {
    setStoreForm({
      id: s.id,
      name: s.name,
      contact_name: s.contact_name,
      phone: s.phone,
      address: s.address,
      mode: s.mode || 'consignment',
      default_cut_per_unit: String(s.default_cut_per_unit || 5),
      visit_cycle_days: String(s.visit_cycle_days || 7),
      owner_notes: s.owner_notes,
      is_active: s.is_active,
    });
    setStoreModalOpen(true);
  };

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await saveStore({
      id: storeForm.id || undefined,
      name: storeForm.name.trim(),
      contact_name: storeForm.contact_name.trim(),
      phone: storeForm.phone.trim(),
      address: storeForm.address.trim(),
      mode: storeForm.mode,
      default_cut_per_unit: Number(storeForm.default_cut_per_unit) || 5,
      visit_cycle_days: Number(storeForm.visit_cycle_days) || 7,
      last_visit_at: storeForm.id
        ? stores.find((s) => s.id === storeForm.id)?.last_visit_at ?? ''
        : '',
      owner_notes: storeForm.owner_notes.trim(),
      is_active: storeForm.is_active,
    });
    setSelectedStoreId(saved.id);
    setStoreModalOpen(false);
  };

  const handlePlaceStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStore) return;
    const items = Object.entries(placeQtyMap)
      .map(([productId, raw]) => ({ productId, qty: Number(raw) || 0 }))
      .filter((i) => i.qty > 0);
    if (items.length === 0) return;
    await placeStockToStore({ storeId: selectedStore.id, items });
    setPlaceQtyMap({});
    setPlaceOpen(false);
  };

  const openVisitReconcile = () => {
    const init: Record<string, string> = {};
    for (const b of storeBatches) {
      init[b.id] = String(b.remaining_qty);
    }
    setRemainingMap(init);
    setAmountCollected('');
    setVisitPaymentStatus('paid');
    setVisitNotes('');
    setVisitOpen(true);
  };

  const visitPreview = useMemo(() => {
    if (!selectedStore) return { rows: [], totalOwnerDue: 0, totalStoreCut: 0, totalProfit: 0 };
    let totalOwnerDue = 0;
    let totalStoreCut = 0;
    let totalProfit = 0;

    const rows = storeBatches
      .map((batch) => {
        const product = productsById.get(batch.product);
        if (!product) return null;
        const override = storeOverrides.get(product.id);
        const counted = Math.max(0, Math.min(batch.remaining_qty, Number(remainingMap[batch.id] ?? batch.remaining_qty)));
        const soldQty = Number((batch.remaining_qty - counted).toFixed(4));
        const sellPrice = batch.clearance_price > 0 ? batch.clearance_price : product.srp_price;
        const storeCut = resolveStoreCut(product, selectedStore, override);
        const ownerNetUnit = Math.max(0, sellPrice - storeCut);
        const lineDue = Number((soldQty * ownerNetUnit).toFixed(2));
        const lineCut = Number((soldQty * storeCut).toFixed(2));
        const lineProfit = Number((lineDue - soldQty * batch.buy_price).toFixed(2));

        totalOwnerDue += lineDue;
        totalStoreCut += lineCut;
        totalProfit += lineProfit;

        return { batch, product, counted, soldQty, sellPrice, storeCut, lineDue, lineCut };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return {
      rows,
      totalOwnerDue: Number(totalOwnerDue.toFixed(2)),
      totalStoreCut: Number(totalStoreCut.toFixed(2)),
      totalProfit: Number(totalProfit.toFixed(2)),
    };
  }, [selectedStore, storeBatches, productsById, storeOverrides, remainingMap]);

  const handleConfirmVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStore) return;
    const paid =
      amountCollected.trim() === ''
        ? visitPaymentStatus === 'paid'
          ? visitPreview.totalOwnerDue
          : 0
        : Number(amountCollected) || 0;

    const result = await reconcileStoreVisit({
      store: selectedStore,
      counts: visitPreview.rows.map((r) => ({
        batch: r.batch,
        product: r.product,
        countedRemaining: r.counted,
        sellPrice: r.sellPrice,
        storeCutPerUnit: r.storeCut,
      })),
      amountCollected: paid,
      paymentStatus: visitPaymentStatus,
      notes: visitNotes,
    });
    setVisitOpen(false);
    setReceiptData({ sale: result.sale, items: result.saleItems, store: selectedStore });
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStore || !ovProductId) return;
    await saveStoreOverride({
      store: selectedStore.id,
      product: ovProductId,
      custom_wholesale_price: Number(ovWholesale) || 0,
      custom_store_cut: Number(ovCut) || 0,
      store_favorability_boost: Number(ovBoost) || 0,
      notes: ovNotes.trim(),
    });
    setOverrideOpen(false);
  };

  return (
    <div className="space-y-5">
      <div className="hidden flex-wrap items-center justify-between gap-3 md:flex">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            Partner stores &amp; consignment
          </h1>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Track stock placed per store, count remaining inventory on visits, and settle commissions
          </p>
        </div>
        <button
          type="button"
          onClick={openAddStore}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Add partner store
        </button>
      </div>

      {/* Mobile horizontal store selector chips (no scrolling past vertical list!) */}
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1 lg:hidden">
        <button
          type="button"
          onClick={openAddStore}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-[var(--accent)] px-3.5 py-2 text-xs font-medium text-[var(--accent)]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Store
        </button>
        {stores.map((st) => {
          const active = selectedStore?.id === st.id;
          return (
            <button
              key={st.id}
              type="button"
              onClick={() => setSelectedStoreId(st.id)}
              className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-medium ${
                active
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
              }`}
            >
              {st.name}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Desktop store list sidebar */}
        <div className="hidden space-y-2 lg:block">
          {stores.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-6 text-center text-xs text-[var(--text-muted)]">
              No partner stores yet. Add a sari-sari store or reseller you supply to.
            </div>
          ) : (
            stores.map((st) => {
              const active = selectedStore?.id === st.id;
              const placed = batches
                .filter((b) => b.store === st.id && b.status === 'active' && b.remaining_qty > 0)
                .reduce((s, b) => s + b.remaining_qty, 0);
              const daysSinceVisit = st.last_visit_at ? Math.abs(daysUntil(st.last_visit_at) ?? 0) : null;
              const dueForVisit = daysSinceVisit !== null && daysSinceVisit >= (st.visit_cycle_days || 7);

              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSelectedStoreId(st.id)}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                      : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm text-[var(--text-primary)]">{st.name}</div>
                    <span className="font-mono-num text-[11px] text-[var(--text-muted)]">
                      {placed} placed
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-[var(--text-secondary)]">
                    <span className="capitalize">{st.mode} · ₱{st.default_cut_per_unit}/unit cut</span>
                    {dueForVisit && (
                      <span className="font-medium text-[var(--warn)]">Visit due</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Selected store workspace */}
        <div className="lg:col-span-2">
          {!selectedStore ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">
              Select a partner store to manage placed stock and visits.
            </div>
          ) : (
            <div className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">
                      {selectedStore.name}
                    </h2>
                    <span className="rounded-md bg-[var(--surface-subtle)] px-2 py-0.5 text-[11px] capitalize text-[var(--text-secondary)]">
                      {selectedStore.mode}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {[selectedStore.contact_name, selectedStore.phone, selectedStore.address]
                      .filter(Boolean)
                      .join(' · ') || 'No contact details added'}
                  </p>
                  <p className="mt-1 font-mono-num text-[11px] text-[var(--text-muted)]">
                    Default cut: {formatPhp(selectedStore.default_cut_per_unit)}/unit · Last visit:{' '}
                    {formatDate(selectedStore.last_visit_at)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPlaceOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
                  >
                    <PackagePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Place stock
                  </button>
                  <button
                    type="button"
                    onClick={openVisitReconcile}
                    disabled={storeBatches.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Count &amp; settle visit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOvProductId(products[0]?.id ?? '');
                      setOvWholesale('');
                      setOvCut('');
                      setOvBoost('0');
                      setOvNotes('');
                      setOverrideOpen(true);
                    }}
                    className="rounded-lg border border-[var(--border-strong)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                    title="Custom price / cut override"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditStore(selectedStore)}
                    className="rounded-lg border border-[var(--border-strong)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                    title="Edit store"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete store ${selectedStore.name}?`)) {
                        void deleteStore(selectedStore.id);
                        setSelectedStoreId(null);
                      }
                    }}
                    className="rounded-lg border border-[var(--border-strong)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
                    title="Delete store"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>

              {/* Placed stock at this store */}
              <div>
                <h3 className="text-xs font-medium text-[var(--text-secondary)]">
                  Currently placed stock ({storeBatches.length} active batches)
                </h3>
                {storeBatches.length === 0 ? (
                  <p className="mt-3 rounded-lg bg-[var(--surface-subtle)] px-4 py-3 text-xs text-[var(--text-muted)]">
                    No stock currently placed at this store. Click &ldquo;Place stock&rdquo; to transfer FEFO batches from your main freezer.
                  </p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="py-2 pr-3 font-medium">Product</th>
                          <th className="py-2 px-3 text-right font-medium">Placed qty</th>
                          <th className="py-2 px-3 text-right font-medium">SRP</th>
                          <th className="py-2 px-3 text-right font-medium">Store cut</th>
                          <th className="py-2 pl-3 font-medium">Expiry</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {storeBatches.map((b) => {
                          const p = productsById.get(b.product);
                          const ov = p ? storeOverrides.get(p.id) : undefined;
                          const cut = p ? resolveStoreCut(p, selectedStore, ov) : 0;
                          return (
                            <tr key={b.id}>
                              <td className="py-2.5 pr-3">
                                <div className="font-medium text-[var(--text-primary)]">
                                  {p?.name ?? 'Unknown'}
                                </div>
                                <div className="font-mono-num text-[11px] text-[var(--text-muted)]">
                                  {b.batch_code}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-num">
                                {b.remaining_qty} {p?.unit ?? ''}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-num">
                                {p ? formatPhp(p.srp_price) : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-num text-[var(--good)]">
                                {formatPhp(cut)}/{p?.unit ?? 'u'}
                              </td>
                              <td className="py-2.5 pl-3 font-mono-num text-[var(--text-secondary)]">
                                {formatDate(b.expiry_date)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Per-client custom price overrides */}
              {storeOverrides.size > 0 && (
                <div className="border-t border-[var(--border)] pt-4">
                  <h3 className="text-xs font-medium text-[var(--text-secondary)]">
                    Custom price &amp; commission overrides
                  </h3>
                  <div className="mt-2 space-y-1.5">
                    {Array.from(storeOverrides.values()).map((ov) => {
                      const p = productsById.get(ov.product);
                      if (!p) return null;
                      return (
                        <div
                          key={ov.id}
                          className="flex items-center justify-between rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-xs"
                        >
                          <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                          <span className="font-mono-num text-[var(--text-secondary)]">
                            Wholesale {formatPhp(resolveWholesalePrice(p, ov))} · Cut{' '}
                            {formatPhp(resolveStoreCut(p, selectedStore, ov))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Store Modal */}
      {storeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-lg">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
                {storeForm.id ? 'Edit partner store' : 'Add partner store'}
              </h2>
              <button
                type="button"
                onClick={() => setStoreModalOpen(false)}
                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <form onSubmit={handleSaveStore} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Store name</label>
                <input
                  required
                  value={storeForm.name}
                  onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })}
                  placeholder="e.g. Aling Nena Sari-Sari Store"
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Contact person</label>
                  <input
                    value={storeForm.contact_name}
                    onChange={(e) => setStoreForm({ ...storeForm, contact_name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Phone</label>
                  <input
                    value={storeForm.phone}
                    onChange={(e) => setStoreForm({ ...storeForm, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Address</label>
                <input
                  value={storeForm.address}
                  onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Mode</label>
                  <select
                    value={storeForm.mode}
                    onChange={(e) => setStoreForm({ ...storeForm, mode: e.target.value as StoreMode })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text-primary)]"
                  >
                    <option value="consignment">Consignment</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="wholesale">Wholesale</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Cut (₱/unit)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={storeForm.default_cut_per_unit}
                    onChange={(e) => setStoreForm({ ...storeForm, default_cut_per_unit: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">Visit cycle (d)</label>
                  <input
                    type="number"
                    min="1"
                    value={storeForm.visit_cycle_days}
                    onChange={(e) => setStoreForm({ ...storeForm, visit_cycle_days: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
                <button
                  type="button"
                  onClick={() => setStoreModalOpen(false)}
                  className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  Save store
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Place Stock Modal */}
      {placeOpen && selectedStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-lg">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
                  Place FEFO stock at {selectedStore.name}
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Earliest-expiring main freezer batches are transferred first
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlaceOpen(false)}
                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <form onSubmit={handlePlaceStock} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)] px-5">
                {products.map((p) => {
                  const mainAvail = batches
                    .filter((b) => b.product === p.id && b.location_type === 'main' && b.status === 'active')
                    .reduce((s, b) => s + b.remaining_qty, 0);
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                      <div>
                        <div className="font-medium text-[var(--text-primary)]">{p.name}</div>
                        <div className="font-mono-num text-[11px] text-[var(--text-muted)]">
                          Main freezer: {mainAvail} {p.unit} · SRP {formatPhp(p.srp_price)}
                        </div>
                      </div>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        placeholder="0"
                        value={placeQtyMap[p.id] ?? ''}
                        onChange={(e) => setPlaceQtyMap({ ...placeQtyMap, [p.id]: e.target.value })}
                        className="w-24 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-right font-mono-num text-sm text-[var(--text-primary)]"
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
                <button
                  type="button"
                  onClick={() => setPlaceOpen(false)}
                  className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  Confirm placement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Consignment Visit Reconciliation Modal */}
      {visitOpen && selectedStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-lg">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
                  Count &amp; settle visit — {selectedStore.name}
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Enter remaining freezer count per batch to calculate sold qty, store commission, and cash remittance
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVisitOpen(false)}
                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleConfirmVisit} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="py-2 pr-2 font-medium">Product</th>
                      <th className="py-2 px-2 text-right font-medium">Placed</th>
                      <th className="py-2 px-2 text-right font-medium">Remaining</th>
                      <th className="py-2 px-2 text-right font-medium">Sold</th>
                      <th className="py-2 px-2 text-right font-medium">Store cut</th>
                      <th className="py-2 pl-2 text-right font-medium">Due to you</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {visitPreview.rows.map((r) => (
                      <tr key={r.batch.id}>
                        <td className="py-2.5 pr-2">
                          <div className="font-medium text-[var(--text-primary)]">{r.product.name}</div>
                          <div className="font-mono-num text-[11px] text-[var(--text-muted)]">
                            SRP {formatPhp(r.sellPrice)} · Cut {formatPhp(r.storeCut)}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono-num">{r.batch.remaining_qty}</td>
                        <td className="py-2.5 px-2 text-right">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max={r.batch.remaining_qty}
                            value={remainingMap[r.batch.id] ?? String(r.batch.remaining_qty)}
                            onChange={(e) =>
                              setRemainingMap({ ...remainingMap, [r.batch.id]: e.target.value })
                            }
                            className="w-20 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-right font-mono-num text-xs text-[var(--text-primary)]"
                          />
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono-num font-medium text-[var(--accent)]">
                          {r.soldQty}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono-num text-[var(--good)]">
                          {formatPhp(r.lineCut)}
                        </td>
                        <td className="py-2.5 pl-2 text-right font-mono-num font-medium text-[var(--text-primary)]">
                          {formatPhp(r.lineDue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-[var(--surface-subtle)] p-4 text-xs">
                  <div>
                    <div className="text-[var(--text-muted)]">Store commission</div>
                    <div className="mt-1 font-mono-num text-base font-semibold text-[var(--good)]">
                      {formatPhp(visitPreview.totalStoreCut)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Remittance due to you</div>
                    <div className="mt-1 font-mono-num text-base font-semibold text-[var(--text-primary)]">
                      {formatPhp(visitPreview.totalOwnerDue)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Your net profit</div>
                    <div className="mt-1 font-mono-num text-base font-semibold text-[var(--accent)]">
                      {formatPhp(visitPreview.totalProfit)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                  <div>
                    <label className="block font-medium text-[var(--text-secondary)]">Cash collected (₱)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={String(visitPreview.totalOwnerDue)}
                      value={amountCollected}
                      onChange={(e) => setAmountCollected(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[var(--text-secondary)]">Payment status</label>
                    <select
                      value={visitPaymentStatus}
                      onChange={(e) => setVisitPaymentStatus(e.target.value as PaymentStatus)}
                      className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                    >
                      <option value="paid">Paid</option>
                      <option value="partial">Partial</option>
                      <option value="unpaid">Unpaid</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-[var(--text-secondary)]">Visit note</label>
                    <input
                      value={visitNotes}
                      onChange={(e) => setVisitNotes(e.target.value)}
                      placeholder="Optional"
                      className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
                <button
                  type="button"
                  onClick={() => setVisitOpen(false)}
                  className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  Complete settlement &amp; receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Override Modal */}
      {overrideOpen && selectedStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-lg">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
                Custom override for {selectedStore.name}
              </h2>
              <button
                type="button"
                onClick={() => setOverrideOpen(false)}
                className="rounded-lg p-1.5 text-[var(--text-secondary)]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <form onSubmit={handleSaveOverride} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Product</label>
                <select
                  required
                  value={ovProductId}
                  onChange={(e) => setOvProductId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Wholesale {formatPhp(p.wholesale_price)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">
                    Custom wholesale (₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={ovWholesale}
                    onChange={(e) => setOvWholesale(e.target.value)}
                    placeholder="0 = default"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-secondary)]">
                    Custom store cut (₱)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={ovCut}
                    onChange={(e) => setOvCut(e.target.value)}
                    placeholder="0 = default"
                    className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">
                  Store favorability boost (-20 to +20)
                </label>
                <input
                  type="number"
                  min="-20"
                  max="20"
                  value={ovBoost}
                  onChange={(e) => setOvBoost(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 font-mono-num text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-[var(--text-secondary)]">Note</label>
                <input
                  value={ovNotes}
                  onChange={(e) => setOvNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
                <button
                  type="button"
                  onClick={() => setOverrideOpen(false)}
                  className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white"
                >
                  Save override
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ReceiptModal
        sale={receiptData?.sale ?? null}
        items={receiptData?.items ?? []}
        productsById={productsById}
        store={receiptData?.store}
        onClose={() => setReceiptData(null)}
      />
    </div>
  );
}
