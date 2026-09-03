import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { useSessionBootstrap } from '@/hooks/useSession';
import { useSystemThemeSync } from '@/hooks/useSystemThemeSync';
import { ApplicationDetailPage } from '@/pages/ApplicationDetailPage';
import { ApplicationsPage } from '@/pages/ApplicationsPage';
import { BoardPage } from '@/pages/BoardPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PublicOnlyRoute } from '@/routes/PublicOnlyRoute';
import { paths } from '@/routes/paths';

/**
 * The route table. The router itself lives in `main.tsx` so tests can mount this
 * inside a `MemoryRouter` and drive it from any starting path.
 *
 * `/applications/board` and `/applications/calendar` are static segments, which
 * react-router ranks above the `/applications/:id` pattern regardless of the
 * order they are declared in.
 */
export function App(): JSX.Element {
  useSessionBootstrap();
  useSystemThemeSync();

  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path={paths.login} element={<LoginPage />} />
        <Route path={paths.register} element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path={paths.dashboard} element={<DashboardPage />} />
          <Route path={paths.applications} element={<ApplicationsPage />} />
          <Route path={paths.board} element={<BoardPage />} />
          <Route path={paths.calendar} element={<CalendarPage />} />
          <Route path="/applications/:applicationId" element={<ApplicationDetailPage />} />
          <Route path={paths.settings} element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
