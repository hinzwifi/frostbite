import { Printer } from 'lucide-react';
import { ModalSheet } from './ModalSheet';
import { formatDateTime, formatPhp } from '../lib/format';
import type { Product, Sale, SaleItem, Store } from '../types/models';

interface Props {
  sale: Sale | null;
  items: SaleItem[];
  productsById: Map<string, Product>;
  store?: Store;
  onClose: () => void;
}

export function ReceiptModal({ sale, items, productsById, store, onClose }: Props) {
  if (!sale) return null;

  const isConsignment = sale.sale_type === 'consignment_settlement';
  const balance = Math.max(0, Number((sale.total_revenue - sale.amount_paid).toFixed(2)));

  return (
    <ModalSheet
      open={Boolean(sale)}
      onClose={onClose}
      title={isConsignment ? 'Consignment settlement receipt' : 'Delivery & sales receipt'}
      maxWidth="max-w-lg"
      headerRight={
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          <Printer className="h-3.5 w-3.5" strokeWidth={1.5} />
          Print / PDF
        </button>
      }
    >
      <div className="bg-white p-6 text-slate-900">
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="text-base font-semibold tracking-tight text-slate-900">Frostbite</div>
            <div className="text-xs text-slate-500">Cold-chain frozen goods supply</div>
          </div>
          <div className="text-right">
            <div className="font-mono-num text-xs font-semibold text-slate-900">{sale.receipt_no}</div>
            <div className="text-xs text-slate-500">{formatDateTime(sale.sold_at)}</div>
          </div>
        </div>

        {store && (
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
            <div className="font-medium text-slate-900">{store.name}</div>
            {store.contact_name && <div className="text-slate-600">{store.contact_name}</div>}
            {store.address && <div className="text-slate-500">{store.address}</div>}
          </div>
        )}

        <table className="mt-4 w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Price</th>
              {isConsignment && <th className="py-2 text-right font-medium">Store cut</th>}
              <th className="py-2 text-right font-medium">Net due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              const product = productsById.get(item.product);
              return (
                <tr key={item.id}>
                  <td className="py-2 text-slate-900">{product?.name ?? 'Item'}</td>
                  <td className="py-2 text-right font-mono-num">
                    {item.qty} {product?.unit ?? ''}
                  </td>
                  <td className="py-2 text-right font-mono-num">{formatPhp(item.unit_price)}</td>
                  {isConsignment && (
                    <td className="py-2 text-right font-mono-num text-emerald-700">
                      -{formatPhp(item.store_cut_per_unit * item.qty)}
                    </td>
                  )}
                  <td className="py-2 text-right font-mono-num font-medium">
                    {formatPhp(item.line_revenue)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 text-xs">
          {isConsignment && (
            <div className="flex justify-between text-emerald-700">
              <span>Partner store earnings (commission)</span>
              <span className="font-mono-num font-medium">{formatPhp(sale.total_store_cut)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-semibold text-slate-900">
            <span>{isConsignment ? 'Remittance due to Frostbite' : 'Total due'}</span>
            <span className="font-mono-num">{formatPhp(sale.total_revenue)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Amount paid</span>
            <span className="font-mono-num">{formatPhp(sale.amount_paid)}</span>
          </div>
          {balance > 0 && (
            <div className="flex justify-between font-medium text-amber-700">
              <span>Remaining balance</span>
              <span className="font-mono-num">{formatPhp(balance)}</span>
            </div>
          )}
        </div>

        {sale.notes && (
          <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
            Notes: {sale.notes}
          </div>
        )}
      </div>
    </ModalSheet>
  );
}
