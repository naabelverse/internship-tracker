import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Shown while the cold-start session restore is still in flight. It mimics the
 * shell rather than showing a full-page spinner, so the layout does not jump once
 * the real content arrives.
 */
export function RouteSkeleton(): JSX.Element {
  return (
    <div className="min-h-screen bg-canvas" data-testid="route-skeleton">
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-64 lg:border-r lg:border-border lg:bg-surface lg:p-3">
        <Skeleton className="h-10 w-full" label="Loading navigation" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-9 w-full" />
          ))}
        </div>
      </div>

      <div className="lg:pl-64">
        <div className="flex h-16 items-center border-b border-border px-4 sm:px-6">
          <Skeleton className="h-8 w-40" label="Loading your session" />
        </div>
        <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
