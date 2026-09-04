import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAccountTheme } from '@/hooks/useAccountTheme';
import { useSessionBootstrap } from '@/hooks/useSession';
import { useSystemThemeSync } from '@/hooks/useSystemThemeSync';
import { ApplicationDetailPage } from '@/pages/ApplicationDetailPage';
import { ApplicationsPage } from '@/pages/ApplicationsPage';
import { BoardPage } from '@/pages/BoardPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { DashboardSkeleton } from '@/features/dashboard/DashboardSkeleton';
import { AccountClosedPage } from '@/pages/AccountClosedPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { LoginPage } from '@/pages/LoginPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { VerifyEmailPage } from '@/pages/VerifyEmailPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PublicOnlyRoute } from '@/routes/PublicOnlyRoute';
import { paths } from '@/routes/paths';

/**
 * SPEC section 12 keeps Chart.js out of every bundle but the dashboard's. The
 * lazy boundary is what makes that true: the page module and its whole chart
 * subtree become a separate chunk, fetched the first time someone opens `/`.
 */
const DashboardPage = lazy(async () => import('@/pages/DashboardPage'));

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
  useAccountTheme();
  useSystemThemeSync();

  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path={paths.login} element={<LoginPage />} />
        <Route path={paths.register} element={<RegisterPage />} />
        <Route path={paths.forgotPassword} element={<ForgotPasswordPage />} />
        <Route path={paths.resetPassword} element={<ResetPasswordPage />} />
      </Route>

      {/*
        Verification and the closed-account notice sit outside both guards. A
        confirmation link is followed from an email on whatever device happens to
        be to hand, signed in or not, and the closed-account page is reached at
        the exact moment the session has just been cleared.
      */}
      <Route path={paths.verifyEmail} element={<VerifyEmailPage />} />
      <Route path={paths.accountClosed} element={<AccountClosedPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route
            path={paths.dashboard}
            element={
              <Suspense fallback={<DashboardSkeleton />}>
                <DashboardPage />
              </Suspense>
            }
          />
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
