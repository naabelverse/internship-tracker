import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * The card surface, defined once.
 *
 * `rounded-card border border-border bg-surface` was written out verbatim at
 * fifteen call sites across the app, carrying six different padding values
 * (`p-2`, `p-3`, `p-4`, `p-4 sm:p-5`, `p-5`, `p-6`) and in two cases none at
 * all. Nothing tied the copies together, so a change to one left the rest
 * silently behind and a new card started from whichever copy its author
 * happened to open. That is the same shape of bug the palette work spent four
 * fixes closing, in surface styling rather than in colour.
 *
 * Twelve of those call sites are now `Card`. The other three take this string
 * instead, each for a structural reason rather than a stylistic one:
 *
 * - `SettingsSection` applies it to a `<form>` it owns for submit handling; a
 *   wrapper component cannot take that over without owning the form.
 * - `Popover` is a floating overlay — `shadow-float`, absolute positioning, its
 *   own stacking context — not a card in the page flow.
 * - `BoardCard` is draggable and swaps to a `ring-2` treatment mid-drag, so its
 *   surface is state-dependent in a way the padding scale does not describe.
 *
 * Forcing those three into `Card` would be a false consolidation: it would make
 * the count look tidier while describing them wrongly. Sharing the string keeps
 * one definition of the surface, which is the part that was actually drifting.
 */
export const cardSurface = 'rounded-card border border-border bg-surface';

/**
 * Internal padding.
 *
 * `standard` is the responsive step-up that `UpcomingPanel`, `ActivityHeatmap`
 * and `ChartFrame` had already converged on independently, which is why it is
 * the default rather than the flat `p-4` the stat cards used. `compact` is for
 * a repeated list row, where the panel step-up reads as loose. `none` is for a
 * card whose children run edge to edge and pad themselves — a table, a month
 * grid — so a rule or a row can meet both borders.
 */
const PADDING = {
  standard: 'p-4 sm:p-5',
  compact: 'p-4',
  none: '',
} as const;

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** The element to render. `div` unless the card is a semantic region. */
  as?: 'div' | 'section' | 'header' | 'li';
  padding?: keyof typeof PADDING;
}

/** A bordered surface on the canvas. The one definition of a card in the app. */
export function Card({
  as: Tag = 'div',
  padding = 'standard',
  className,
  children,
  ...props
}: CardProps): JSX.Element {
  return (
    <Tag {...props} className={cn(cardSurface, PADDING[padding], className)}>
      {children}
    </Tag>
  );
}
