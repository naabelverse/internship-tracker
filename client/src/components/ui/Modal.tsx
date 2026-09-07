import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { CloseIcon } from '@/components/ui/icons';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}

/**
 * A dialog rendered into a portal, so it escapes any transformed or overflowing
 * ancestor. While open it traps Tab, closes on Escape, restores focus to the
 * element that opened it, and locks body scroll so the page behind cannot move.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useFocusTrap(panelRef, isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'atmos-lit relative flex max-h-[92vh] w-full flex-col rounded-t-card border border-border bg-surface shadow-float',
          'sm:rounded-card',
          size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-content">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-content-muted">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-control p-1.5 text-content-subtle transition-colors hover:bg-surface-muted hover:text-content"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
