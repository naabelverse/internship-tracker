import { PhasePlaceholder } from '@/pages/PhasePlaceholder';

export function ApplicationDetailPage(): JSX.Element {
  return (
    <PhasePlaceholder
      phase={6}
      title="Application detail"
      description="Status timeline, markdown notes with autosave, interviews and attachments for a single application."
    />
  );
}
