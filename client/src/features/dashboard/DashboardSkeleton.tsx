import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Stands in for the dashboard while its lazy chunk downloads. It mirrors the
 * real grid so the page does not jump once Chart.js has arrived.
 */
export function DashboardSkeleton(): JSX.Element {
  return (
    <div className="space-y-4" data-testid="dashboard-skeleton">
      <Skeleton className="h-8 w-48" label="Loading dashboard" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((card) => (
          <Skeleton key={card} className="h-28 w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 w-full lg:col-span-2" />
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  );
}
