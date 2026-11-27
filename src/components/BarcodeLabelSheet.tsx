import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { Printer, X } from 'lucide-react';
import { formatPhp } from '../lib/format';
import type { Product } from '../types/models';

interface Props {
  products: Product[];
  open: boolean;
  onClose: () => void;
}

function LabelCard({
  product,
  mode,
  expiryDate,
}: {
  product: Product;
  mode: 'barcode' | 'qr';
  expiryDate?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [qrUrl, setQrUrl] = useState<string>('');

  useEffect(() => {
    if (mode === 'barcode' && svgRef.current) {
      try {
        JsBarcode(svgRef.current, product.barcode || product.sku || product.id, {
          format: 'CODE128',
          width: 1.5,
          height: 36,
          displayValue: true,
          fontSize: 11,
          margin: 4,
          background: '#ffffff',
          lineColor: '#0f172a',
        });
      } catch {
        // fallback handled by text
      }
    } else if (mode === 'qr') {
      void QRCode.toDataURL(product.barcode || product.sku || product.id, {
        width: 96,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      }).then(setQrUrl);
    }
  }, [product, mode]);

  return (
    <div className="print-break-avoid flex flex-col justify-between rounded-lg border border-slate-300 bg-white p-3 text-slate-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-900">{product.name}</div>
          <div className="text-[11px] text-slate-600">
            {product.unit} {expiryDate ? `· Exp ${expiryDate}` : ''}
          </div>
        </div>
        <div className="shrink-0 font-mono-num text-xs font-semibold text-slate-900">
          {formatPhp(product.srp_price)}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-center">
        {mode === 'barcode' ? (
          <svg ref={svgRef} className="max-w-full" />
        ) : qrUrl ? (
          <div className="flex items-center gap-3">
            <img src={qrUrl} alt={product.barcode} className="h-16 w-16" />
            <div className="font-mono-num text-[11px] text-slate-700">{product.barcode}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function BarcodeLabelSheet({ products, open, onClose }: Props) {
  const [mode, setMode] = useState<'barcode' | 'qr'>('barcode');
  const [copies, setCopies] = useState(4);
  const [expiryDate, setExpiryDate] = useState('');

  if (!open) return null;

  const expanded: Product[] = [];
  for (const p of products) {
    for (let i = 0; i < copies; i++) expanded.push(p);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-lg">
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
              Printable barcode &amp; QR labels
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              {products.length} product{products.length === 1 ? '' : 's'} · {expanded.length} total labels
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[var(--border-strong)] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMode('barcode')}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  mode === 'barcode'
                    ? 'bg-[var(--surface-subtle)] font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                Code128
              </button>
              <button
                type="button"
                onClick={() => setMode('qr')}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  mode === 'qr'
                    ? 'bg-[var(--surface-subtle)] font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                QR code
              </button>
            </div>

            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              Copies
              <input
                type="number"
                min={1}
                max={40}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
                className="w-14 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 font-mono-num text-xs text-[var(--text-primary)]"
              />
            </label>

            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              Expiry
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
              />
            </label>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
            >
              <Printer className="h-3.5 w-3.5" strokeWidth={1.5} />
              Print sheet
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] transition-colors"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {expanded.map((p, idx) => (
              <LabelCard key={`${p.id}-${idx}`} product={p} mode={mode} expiryDate={expiryDate} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
