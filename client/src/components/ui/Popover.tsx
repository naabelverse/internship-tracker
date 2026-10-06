import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
  /**
   * Classes for the panel's size and inset in place of the menus' scrolling
   * list. Such a panel sits on the plain card rather than `.scroll-panel`.
   */
  panelClassName?: string;
  /**
   * `dialog` for a panel that is a picker in its own right, such as a calendar.
   * `menu` for a list of actions rendered as `role="menuitem"` buttons: opening
   * focuses the first item, and the arrow keys, Home and End move between them.
   */
  role?: 'group' | 'dialog' | 'menu';
  /** Marks the trigger `aria-busy` while the action it leads to is running. */
  busy?: boolean;
  /**
   * Floats the panel under this element with fixed positioning instead of under
   * the trigger, so a scrolling ancestor such as a modal body cannot clip it.
   * The panel stays here in the DOM, so an enclosing focus trap still holds it.
   */
  anchorRef?: RefObject<HTMLElement>;
}

const MENU_TRIGGER =
  'inline-flex h-9 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm font-medium text-content transition-colors hover:bg-surface-muted';
/**
 * The menus' scrolling list on the shared scrolling panel (`index.css`). Its
 * 4px border plus `p-[5px]` puts content where `border p-2` did, 9px in.
 */
const MENU_PANEL = 'scroll-panel max-h-80 w-60 overflow-y-auto p-[5px]';
const MENU_ITEM = '[role="menuitem"]';
const HAS_POPUP = { group: 'true', dialog: 'dialog', menu: 'menu' } as const;

/** Moves focus between a `menu` panel's items: arrows wrap, Home and End jump. */
function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM)];
  const current = items.findIndex((item) => item === document.activeElement);
  const last = items.length - 1;
  const targets: Record<string, number | undefined> = {
    ArrowDown: current >= last ? 0 : current + 1,
    ArrowUp: current <= 0 ? last : current - 1,
    Home: 0,
    End: last,
  };
  const next = targets[event.key];
  if (next === undefined || items.length === 0) return;

  event.preventDefault();
  items[next]?.focus();
}

/**
 * A small disclosure used by the filter and column menus, by `DateField`'s
 * calendar and, as a `menu`, by the export choices. It closes on Escape, on a click outside and when focus tabs out,
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
    busy,
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

  // A menu is operated from its items, so opening one puts focus on the first.
  useEffect(() => {
    if (isOpen && role === 'menu') panelRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [isOpen, role]);

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
        aria-haspopup={HAS_POPUP[role]}
        aria-busy={busy}
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
          onKeyDown={role === 'menu' ? onMenuKeyDown : undefined}
          style={anchoredPosition}
          className={cn(
            'z-30',
            panelClassName === undefined
              ? MENU_PANEL
              : cn(cardSurface, 'shadow-float', panelClassName),
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
