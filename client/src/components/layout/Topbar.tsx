import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { LogOutIcon, MenuIcon } from '@/components/ui/icons';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useLogout } from '@/features/auth/useAuthMutations';
import { useSession } from '@/hooks/useSession';

interface TopbarProps {
  isNavOpen: boolean;
  onOpenNav: () => void;
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
        className="rounded-control p-2 text-content-muted transition-colors hover:bg-surface-muted hover:text-content lg:hidden"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1" />

      <ThemeToggle />

      {user && (
        <div className="flex items-center gap-2">
          <UserAvatar name={user.name} src={user.avatarUrl} />
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
