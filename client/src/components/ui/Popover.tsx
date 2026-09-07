import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PopoverProps {
  label: string;
  /** Rendered inside the trigger, e.g. a count of active selections. */
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}

/**
 * A small disclosure used by the filter and column menus. It closes on Escape and
 * on a click outside, and returns focus to the trigger, so it is keyboard usable
 * without pulling in a headless UI dependency the locked stack does not name.
 */
export function Popover({ label, trigger, children, align = 'left' }: PopoverProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const close = (): void => {
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="true"
        onClick={() => {
          setIsOpen((open) => !open);
        }}
        className="inline-flex h-9 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm font-medium text-content transition-colors hover:bg-surface-muted"
      >
        {trigger}
      </button>

      {isOpen && (
        <div
          role="group"
          aria-label={label}
          className={cn(
            'absolute z-30 mt-2 max-h-80 w-60 overflow-y-auto rounded-card border border-border bg-surface p-2 shadow-float',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children(() => {
            setIsOpen(false);
            triggerRef.current?.focus();
          })}
        </div>
      )}
    </div>
  );
}
