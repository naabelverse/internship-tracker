import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { LogOutIcon, MenuIcon } from '@/components/ui/icons';
import { useLogout } from '@/features/auth/useAuthMutations';
import { useSession } from '@/hooks/useSession';

interface TopbarProps {
  isNavOpen: boolean;
  onOpenNav: () => void;
}

/** Initials stand in for the avatar until Phase 9 wires uploads into settings. */
function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function Topbar({ isNavOpen, onOpenNav }: TopbarProps): JSX.Element {
  const { user } = useSession();
  const logout = useLogout();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        aria-expanded={isNavOpen}
        aria-controls="app-navigation"
        className="rounded-control p-2 text-content-muted hover:bg-surface-muted hover:text-content lg:hidden"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1" />

      <ThemeToggle />

      {user && (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
          >
            {initials(user.name)}
          </span>
          <span className="hidden max-w-[10rem] truncate text-sm text-content-muted sm:block">
            {user.name}
          </span>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        aria-label="Sign out"
        isLoading={logout.isPending}
        loadingLabel=""
        onClick={() => {
          logout.mutate();
        }}
        className="px-2"
      >
        <LogOutIcon className="h-5 w-5" />
      </Button>
    </header>
  );
}
