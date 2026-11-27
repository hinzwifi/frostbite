import { useEffect, useRef } from 'react';

/**
 * Listens for USB/Bluetooth HID keyboard-wedge barcode scanners.
 * Hardware scanners type characters rapidly (< 45ms apart) and finish with Enter.
 */
export function useBarcodeWedge(onScan: (code: string) => void, enabled = true) {
  const bufferRef = useRef('');
  const lastTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // Don't hijack normal typing inside form inputs unless it's explicitly a barcode input
      if (isInput && !target.dataset.barcodeTarget) return;

      const now = Date.now();
      if (now - lastTimeRef.current > 80) {
        bufferRef.current = '';
      }
      lastTimeRef.current = now;

      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (code.length >= 4) {
          e.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
