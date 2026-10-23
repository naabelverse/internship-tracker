import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

export interface SettingsNavItem {
  id: string;
  label: string;
}

interface SettingsNavProps {
  /** Must be stable across renders (a module constant): the effect keys on it. */
  items: readonly SettingsNavItem[];
}

/** Clears the sticky top bar (h-16) with room to spare; matches `scroll-mt-24`. */
const ACTIVE_LINE_PX = 96;

/**
 * The section a reader is in: the last one whose top has scrolled past the line
 * under the top bar.
 *
 * The short sections at the end can never reach that line, so at the very bottom
 * the linked section wins while it is on screen (a click on "Your data" lands
 * here, not on its line), and otherwise the last one does. A page that has not
 * scrolled is never "at the bottom", or one that fits the window would mark its
 * last card.
 */
function currentSection(items: readonly SettingsNavItem[]): string | undefined {
  const atBottom =
    window.scrollY > 0 &&
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  if (atBottom) {
    const linked = window.location.hash.slice(1);
    const top = items.some(({ id }) => id === linked)
      ? document.getElementById(linked)?.getBoundingClientRect().top
      : undefined;
    const onScreen = top !== undefined && top >= 0 && top < window.innerHeight;
    return onScreen ? linked : items[items.length - 1]?.id;
  }

  let current = items[0]?.id;
  for (const { id } of items) {
    const top = document.getElementById(id)?.getBoundingClientRect().top;
    if (top !== undefined && top <= ACTIVE_LINE_PX) current = id;
  }
  return current;
}

/**
 * "On this page" for Settings: plain anchor links to each section, with the one
 * in view marked. Only rendered beside the cards on wide screens, where it fills
 * the space the single column leaves; below that it would push the cards down.
 */
export function SettingsNav({ items }: SettingsNavProps): JSX.Element {
  const [active, setActive] = useState<string | undefined>(items[0]?.id);

  useEffect(() => {
    // A deep link such as /settings#sessions arrives before the lazy route has
    // rendered its sections, so the browser's own jump finds nothing.
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView();

    let frame = 0;
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setActive(currentSection(items));
      });
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // Already at the bottom, a click changes the hash without scrolling.
    window.addEventListener('hashchange', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('hashchange', update);
    };
  }, [items]);

  return (
    <nav aria-label="Settings sections" className="hidden xl:block">
      <div className="sticky top-24">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
          On this page
        </p>
        <ul className="border-l border-border">
          {items.map(({ id, label }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={active === id ? 'location' : undefined}
                className={cn(
                  '-ml-px block border-l-2 py-1.5 pl-3 text-sm transition-colors',
                  active === id
                    ? 'border-primary font-medium text-content'
                    : 'border-transparent text-content-muted hover:text-content',
                )}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
