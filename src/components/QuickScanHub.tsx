import { useState } from 'react';
import { PackagePlus, Pencil, Plus, ShoppingCart } from 'lucide-react';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { ModalSheet } from './ModalSheet';
import { formatPhp } from '../lib/format';
import { recordDirectSale } from '../lib/inventory';
import type { Product, ProductMetrics } from '../types/models';

interface Props {
  open: boolean;
  onClose: () => void;
  products: Product[];
  metricsById: Map<string, ProductMetrics>;
  onOpenPos: () => void;
  onOpenProductInCatalog: (productId: string) => void;
  onCreateProductWithBarcode: (barcode: string) => void;
}

export function QuickScanHub({
  open,
  onClose,
  products,
  metricsById,
  onOpenPos,
  onOpenProductInCatalog,
  onCreateProductWithBarcode,
}: Props) {
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [matchedProduct, setMatchedProduct] = useState<Product | null>(null);
  const [quickSelling, setQuickSelling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleDetected = (code: string) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(15);
    }
    const found = products.find(
      (p) =>
        p.barcode.toLowerCase() === code.toLowerCase() ||
        p.sku.toLowerCase() === code.toLowerCase()
    );
    setScannedCode(code);
    setMatchedProduct(found ?? null);
    setToast(null);
  };

  const resetAndClose = () => {
    setScannedCode(null);
    setMatchedProduct(null);
    setToast(null);
    onClose();
  };

  const handleQuickSellOne = async () => {
    if (!matchedProduct) return;
    setQuickSelling(true);
    try {
      await recordDirectSale({
        saleType: 'retail',
        items: [{ productId: matchedProduct.id, qty: 1, unitPrice: matchedProduct.srp_price }],
        amountPaid: matchedProduct.srp_price,
        paymentStatus: 'paid',
        notes: 'Quick scan sale',
      });
      setToast(`Sold 1 ${matchedProduct.unit} of ${matchedProduct.name} (${formatPhp(matchedProduct.srp_price)})`);
    } finally {
      setQuickSelling(false);
    }
  };

  // Phase 1: Camera / Barcode Scanner
  if (open && !scannedCode) {
    return (
      <BarcodeScannerModal
        open={open}
        onClose={resetAndClose}
        onDetected={handleDetected}
        title="Quick scan"
      />
    );
  }

  // Phase 2: Action Sheet for the scanned barcode
  const metrics = matchedProduct ? metricsById.get(matchedProduct.id) : undefined;

  return (
    <ModalSheet
      open={open && Boolean(scannedCode)}
      onClose={resetAndClose}
      title={matchedProduct ? matchedProduct.name : 'New barcode detected'}
      subtitle={scannedCode ?? undefined}
      maxWidth="max-w-md"
    >
      <div className="space-y-4 p-5">
        {matchedProduct ? (
          <>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[var(--surface-subtle)] p-3.5 text-center">
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">SRP</div>
                <div className="mt-0.5 font-mono-num text-sm font-semibold text-[var(--text-primary)]">
                  {formatPhp(matchedProduct.srp_price)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Main stock</div>
                <div className="mt-0.5 font-mono-num text-sm font-semibold text-[var(--text-primary)]">
                  {metrics?.mainQty ?? 0} {matchedProduct.unit}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Favorability</div>
                <div className="mt-0.5 font-mono-num text-sm font-semibold text-[var(--accent)]">
                  {metrics?.favorabilityScore ?? 0}/100
                </div>
              </div>
            </div>

            {toast && (
              <div className="rounded-xl bg-[var(--good-subtle)] px-3.5 py-2.5 text-xs font-medium text-[var(--good)]">
                {toast}
              </div>
            )}

            <div className="space-y-2">
              <button
                type="button"
                disabled={quickSelling}
                onClick={() => void handleQuickSellOne()}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                <ShoppingCart className="h-4 w-4" strokeWidth={1.75} />
                {quickSelling
                  ? 'Recording'
                  : `Quick sell 1 ${matchedProduct.unit} (${formatPhp(matchedProduct.srp_price)})`}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = matchedProduct.id;
                    resetAndClose();
                    onOpenProductInCatalog(id);
                  }}
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)]"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Inspect &amp; edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetAndClose();
                    onOpenPos();
                  }}
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)]"
                >
                  <PackagePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Open full POS
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[var(--text-secondary)]">
              No product in your catalog matches barcode{' '}
              <span className="font-mono-num font-medium text-[var(--text-primary)]">{scannedCode}</span>.
            </p>
            <button
              type="button"
              onClick={() => {
                const code = scannedCode ?? '';
                resetAndClose();
                onCreateProductWithBarcode(code);
              }}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Create product with this barcode
            </button>
          </div>
        )}
      </div>
    </ModalSheet>
  );
}
