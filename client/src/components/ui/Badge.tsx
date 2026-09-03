import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A small token-coloured pill. Callers pass the palette from `lib/statusConfig`. */
export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        className,
      )}
    >
      {children}
    </span>
  );
}
