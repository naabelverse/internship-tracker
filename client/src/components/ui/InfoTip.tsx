import { useRef, type ReactNode } from 'react';
import { Popover } from '@/components/ui/Popover';
import { HelpIcon } from '@/components/ui/icons';

interface InfoTipProps {
  /** What the tip explains, e.g. "About the heatmap": the button's name and the panel's. */
  label: string;
  children: ReactNode;
}

/**
 * A 14px icon on the small subtle text's colour, so it sits in a caption line
 * without changing its 16px height. The pseudo-element takes the target to
 * 26px, past WCAG 2.2's 24px minimum, without a box that would push its
 * neighbours apart. Block-level `flex`, not `inline-flex`: `Popover` wraps the
 * trigger in a `div`, and an inline trigger gives that div a line box at the
 * body's 24px line height, which grew every caption row it sat in to 24px.
 */
const TRIGGER =
  "relative flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-content-subtle transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:text-content";
const PANEL = 'w-64 space-y-2 p-3 text-xs leading-relaxed text-content-muted';

/**
 * A "(?)" that opens a short explanation on click or Enter, and closes on
 * Escape, a click outside or focus leaving it. It is `Popover` with an icon
 * trigger, not a hover tooltip: a hover tip cannot be opened on a phone, and
 * `title` text cannot be reached from a keyboard at all. The panel floats on
 * the trigger with fixed positioning, so it stays inside the viewport's gutter
 * from any corner of a card.
 */
export function InfoTip({ label, children }: InfoTipProps): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Popover
      ref={triggerRef}
      anchorRef={triggerRef}
      label={label}
      triggerLabel={label}
      trigger={<HelpIcon className="h-3.5 w-3.5" />}
      triggerClassName={TRIGGER}
      panelClassName={PANEL}
      role="dialog"
    >
      {() => children}
    </Popover>
  );
}
