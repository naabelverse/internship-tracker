import { PhasePlaceholder } from '@/pages/PhasePlaceholder';

export function DashboardPage(): JSX.Element {
  return (
    <PhasePlaceholder
      phase={8}
      title="Dashboard"
      description="Stat cards with period deltas, the Chart.js visuals, the activity heatmap and the upcoming deadlines panel."
    />
  );
}
