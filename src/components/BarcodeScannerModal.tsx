import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  title?: string;
}

export function BarcodeScannerModal({ open, onClose, onDetected, title = 'Scan barcode' }: Props) {
  const regionId = useId().replace(/:/g, '');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);

    const startScanner = async () => {
      try {
        const scanner = new Html5Qrcode(regionId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 12, qrbox: { width: 260, height: 140 } },
          (decodedText) => {
            if (!active) return;
            active = false;
            onDetected(decodedText.trim());
            onClose();
          },
          () => {
            // Frame had no barcode; ignore
          }
        );
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : 'Camera unavailable';
        setError(
          `${msg}. Camera scanning requires HTTPS (Tailscale Serve) or localhost. You can still type or use a USB/Bluetooth scanner below.`
        );
      }
    };

    void startScanner();

    return () => {
      active = false;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        void s
          .stop()
          .catch(() => undefined)
          .finally(() => {
            try {
              s.clear();
            } catch {
              // ignore
            }
          });
      }
    };
  }, [open, regionId, onDetected, onClose]);

  if (!open) return null;

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualCode.trim();
    if (!trimmed) return;
    onDetected(trimmed);
    setManualCode('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-lg">
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-[var(--text-secondary)]" strokeWidth={1.5} />
            <h2 className="text-[15px] font-medium text-[var(--text-primary)]">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] transition-colors"
            aria-label="Close scanner"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="mt-4">
          <div
            id={regionId}
            className="min-h-[220px] w-full overflow-hidden rounded-xl border border-[var(--border)] bg-slate-950"
          />
          {error && (
            <p className="mt-3 rounded-lg bg-[var(--warn-subtle)] px-3 py-2 text-xs text-[var(--warn)]">
              {error}
            </p>
          )}
        </div>

        <form onSubmit={submitManual} className="mt-4 flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Or enter / scan barcode manually"
            data-barcode-target="true"
            autoFocus
            className="flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm font-mono-num text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            Use
          </button>
        </form>
      </div>
    </div>
  );
}
