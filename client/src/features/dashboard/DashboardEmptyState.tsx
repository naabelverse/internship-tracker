import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useLoadDemoData } from '@/features/dashboard/useDemoData';

interface DashboardEmptyStateProps {
  onCreate: () => void;
}

/**
 * What a brand new account sees instead of six charts drawing nothing.
 *
 * "Load demo data" posts to `/applications/demo-data`, which fills an account
 * that has no applications with the same fixture set the seed script uses. The
 * server refuses a non-empty account, so the button cannot damage real data
 * even if it is reached some other way.
 */
export function DashboardEmptyState({ onCreate }: DashboardEmptyStateProps): JSX.Element {
  const demoData = useLoadDemoData();

  return (
    <EmptyState
      title="Your dashboard is waiting on its first application"
      message="Add the role you are chasing and the charts, funnel and streak fill in from there. No data of your own yet? Load a realistic sample search to look around first."
      action={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onCreate}>Add your first application</Button>
          <Button
            variant="secondary"
            onClick={() => {
              demoData.mutate();
            }}
            isLoading={demoData.isPending}
            loadingLabel="Loading sample data"
          >
            Load demo data
          </Button>
        </div>
      }
    />
  );
}
