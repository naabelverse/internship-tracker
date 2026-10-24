import { useState } from 'react';
import { cn } from '@/lib/cn';

interface UserAvatarProps {
  name: string;
  src?: string;
  /** 32 px in the top bar, 56 px beside the upload controls. */
  size?: keyof typeof SIZES;
}

/**
 * Sizes as whole class sets. `cn` joins rather than merges, so passing `h-14`
 * next to a default `h-8` left both on the element and the default won.
 */
const SIZES = {
  sm: 'h-8 w-8 text-xs',
  lg: 'h-14 w-14 text-base',
} as const;

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
export function UserAvatar({ name, src, size = 'sm' }: UserAvatarProps): JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string>();
  const base = cn(
    'grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary/15 font-semibold text-primary',
    SIZES[size],
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
