import { DashboardView } from '@/features/dashboard/DashboardView';

/**
 * The dashboard route. The whole body, Chart.js included, sits behind the
 * `React.lazy` boundary declared in the route table, so this module and
 * everything it imports form their own chunk.
 */
export function DashboardPage(): JSX.Element {
  return <DashboardView />;
}

export default DashboardPage;
