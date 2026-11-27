import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: string;
  headerRight?: ReactNode;
  children: ReactNode;
}

/** Apple's exact momentum projection (Designing Fluid Interfaces, WWDC 2018) */
function project(initialVelocityPxPerSec: number, decelerationRate = 0.998): number {
  return ((initialVelocityPxPerSec / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive rubber-band resistance when dragging upward past boundary */
function rubberband(overshoot: number, dimension = 320, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Apple-style fluid responsive overlay:
 * - On phones: draggable bottom sheet with 1:1 pointer tracking, rubber-band top boundary,
 *   and momentum-projected dismiss.
 * - On desktop: centered frosted dialog with Escape-to-close.
 */
export function ModalSheet({
  open,
  onClose,
  title,
  subtitle,
  maxWidth = 'max-w-lg',
  headerRight,
  children,
}: Props) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const lastYRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setDragY(0);
      setDragging(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    startYRef.current = e.clientY - dragY;
    lastYRef.current = e.clientY;
    lastTimeRef.current = performance.now();
    velocityRef.current = 0;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max(1, now - lastTimeRef.current);
    velocityRef.current = ((e.clientY - lastYRef.current) / dt) * 1000;
    lastYRef.current = e.clientY;
    lastTimeRef.current = now;

    const rawDelta = e.clientY - startYRef.current;
    if (rawDelta < 0) {
      setDragY(-rubberband(Math.abs(rawDelta), 280, 0.35));
    } else {
      setDragY(rawDelta);
    }
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    const projected = dragY + project(velocityRef.current, 0.992);
    if (projected > 140 || dragY > 120) {
      onClose();
    } else {
      setDragY(0);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-[3px] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={`sheet-surface flex max-h-[92dvh] w-full ${maxWidth} flex-col rounded-t-[22px] border border-[var(--border-strong)] bg-[var(--surface)] sm:rounded-2xl`}
        style={{
          transform: dragY !== 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? 'none' : 'transform 300ms var(--ease-drawer)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Draggable header handle region on mobile */}
        <div
          className="no-print cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="flex justify-center pt-2.5 sm:hidden">
            <div className="h-1 w-10 rounded-full bg-[var(--border-strong)]" />
          </div>

          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold text-[var(--text-primary)]">
                {title}
              </h2>
              {subtitle && (
                <p className="truncate text-xs text-[var(--text-secondary)]">{subtitle}</p>
              )}
            </div>
            <div
              className="flex shrink-0 items-center gap-2"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {headerRight}
              <button
                type="button"
                onClick={onClose}
                aria-label={`Close ${title}`}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain safe-bottom">{children}</div>
      </div>
    </div>
  );
}
