import { PhasePlaceholder } from '@/pages/PhasePlaceholder';

export function ApplicationsPage(): JSX.Element {
  return (
    <PhasePlaceholder
      phase={6}
      title="Applications"
      description="The server-paginated table with filters synced to the URL, bulk actions and the create and edit modal."
    />
  );
}
