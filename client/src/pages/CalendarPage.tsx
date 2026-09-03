import { PhasePlaceholder } from '@/pages/PhasePlaceholder';

export function CalendarPage(): JSX.Element {
  return (
    <PhasePlaceholder
      phase={7}
      title="Calendar"
      description="A month grid of deadlines and interviews, with a day list and a link through to each application."
    />
  );
}
