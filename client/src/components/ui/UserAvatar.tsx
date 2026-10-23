import { useState } from 'react';
import { cn } from '@/lib/cn';

interface UserAvatarProps {
  name: string;
  src?: string;
  /** Overrides the default 32 px size and type scale. */
  className?: string;
}

/** Up to two initials: "Ada Lovelace" becomes "AL". */
function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The account's picture from `avatarUrl`, or its initials when there is none or
 * the image fails to load. Decorative: the name always sits beside it in text.
 *
 * The failure is remembered per URL rather than as a flag, so saving a new URL
 * after a broken one tries the new image without an effect to reset state.
 */
export function UserAvatar({ name, src, className }: UserAvatarProps): JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string>();
  const base = cn(
    'grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/15 text-xs font-semibold text-primary',
    className,
  );

  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        onError={() => {
          setFailedSrc(src);
        }}
        className={cn(base, 'object-cover')}
      />
    );
  }

  return (
    <span aria-hidden="true" className={base}>
      {initials(name)}
    </span>
  );
}
