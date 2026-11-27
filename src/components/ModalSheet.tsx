import { useEffect, type ReactNode } from 'react';
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

/**
 * Responsive native-feeling overlay:
 * Slides up as a bottom sheet on phones (with safe-area padding & grabber)
 * and renders as a crisp centered dialog on desktop.
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={`sheet-surface flex max-h-[92dvh] w-full ${maxWidth} flex-col rounded-t-2xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-lg sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile bottom-sheet grabber */}
        <div className="no-print flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-9 rounded-full bg-[var(--border-strong)]" />
        </div>

        <div className="no-print flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-medium text-[var(--text-primary)]">{title}</h2>
            {subtitle && (
              <p className="truncate text-xs text-[var(--text-secondary)]">{subtitle}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerRight}
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain safe-bottom">
          {children}
        </div>
      </div>
    </div>
  );
}
