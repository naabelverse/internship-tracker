import { cn } from '@/lib/cn';
import { STATUS_CONFIG } from '@/lib/statusConfig';
import type { ApplicationStatus } from '@/types/application';

/**
 * The sizes a dot is drawn at, and the ring weight a hollow one gets at each.
 * The ring has to leave a hole that still reads as one: a two-pixel ring on a
 * six-pixel dot would not, so a size that small would need a one-pixel ring.
 */
const SIZES = {
  sm: { box: 'h-2 w-2', ring: 'border-2' },
  md: { box: 'h-2.5 w-2.5', ring: 'border-2' },
} as const;

interface StatusDotProps {
  status: ApplicationStatus;
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * The colour swatch that sits beside a status label: on the board's column
 * headers, the timeline and the dashboard legend.
 *
 * It is always decorative. Every site pairs it with the label as text, so a
 * reader who cannot see the colour loses nothing; what the dot adds is a
 * second cue at a glance. Ghosted is drawn as a ring rather than a disc so
 * that second cue does not itself depend on hue.
 */
export function StatusDot({ status, size = 'sm', className }: StatusDotProps): JSX.Element {
  const config = STATUS_CONFIG[status];
  const { box, ring } = SIZES[size];

  return (
    <span
      aria-hidden="true"
      data-status-dot={config.hollow ? 'hollow' : 'solid'}
      className={cn(
        'inline-block shrink-0 rounded-full',
        box,
        config.dot,
        config.hollow && ring,
        className,
      )}
    />
  );
}
