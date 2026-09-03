import { PhasePlaceholder } from '@/pages/PhasePlaceholder';

export function BoardPage(): JSX.Element {
  return (
    <PhasePlaceholder
      phase={7}
      title="Board"
      description="The dnd-kit Kanban with per-column counts and optimistic status changes that roll back on failure."
    />
  );
}
