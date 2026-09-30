import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '@/lib/cn';
import { assignRef } from '@/lib/assignRef';
import { cardSurface } from '@/components/ui/Card';
import { useAnchoredPosition } from '@/hooks/useAnchoredPosition';

interface PopoverProps {
  label: string;
  /** Rendered inside the trigger, e.g. a count of active selections. */
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  /** The trigger's accessible name, for a trigger that shows only an icon. */
  triggerLabel?: string;
  /** Classes for the trigger in place of the toolbar's bordered button. */
  triggerClassName?: string;
  /** Classes for the panel's size and inset in place of the menus' scrolling list. */
  panelClassName?: string;
  /** `dialog` for a panel that is a picker in its own right, such as a calendar. */
  role?: 'group' | 'dialog';
  /**
   * Floats the panel under this element with fixed positioning instead of under
   * the trigger, so a scrolling ancestor such as a modal body cannot clip it.
   * The panel stays here in the DOM, so an enclosing focus trap still holds it.
   */
  anchorRef?: RefObject<HTMLElement>;
}

const MENU_TRIGGER =
  'inline-flex h-9 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm font-medium text-content transition-colors hover:bg-surface-muted';
const MENU_PANEL = 'max-h-80 w-60 overflow-y-auto p-2';

/**
 * A small disclosure used by the filter and column menus and by `DateField`'s
 * calendar. It closes on Escape, on a click outside and when focus tabs out,
 * and returns focus to the trigger, so it is keyboard usable without pulling in
 * a headless UI dependency the locked stack does not name. The ref reaches the
 * trigger.
 */
export const Popover = forwardRef<HTMLButtonElement, PopoverProps>(function Popover(
  {
    label,
    trigger,
    children,
    align = 'left',
    triggerLabel,
    triggerClassName,
    panelClassName,
    role = 'group',
    anchorRef,
  },
  forwardedRef,
) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const anchoredPosition = useAnchoredPosition(anchorRef, panelRef, isOpen, align);

  const setTriggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      assignRef(forwardedRef, node);
    },
    [forwardedRef],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    // Caught in the capture phase and stopped there: a modal's focus trap also
    // listens for Escape on the document, and one press should close only the
    // innermost layer, not the dialog and the unsaved form behind it.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onPointerDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [isOpen, close]);

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (isOpen && next instanceof Node && !containerRef.current?.contains(next)) setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative" onBlur={onBlur}>
      <button
        ref={setTriggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-expanded={isOpen}
        aria-haspopup={role === 'dialog' ? 'dialog' : 'true'}
        onClick={() => {
          setIsOpen((open) => !open);
        }}
        className={triggerClassName ?? MENU_TRIGGER}
      >
        {trigger}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          role={role}
          aria-label={label}
          style={anchoredPosition}
          className={cn(
            cardSurface,
            'z-30 shadow-float',
            panelClassName ?? MENU_PANEL,
            anchorRef && 'fixed',
            !anchorRef && 'absolute mt-2',
            !anchorRef && (align === 'right' ? 'right-0' : 'left-0'),
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
});
