import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RouteSkeleton } from '@/components/layout/RouteSkeleton';
import { DashboardSkeleton } from '@/features/dashboard/DashboardSkeleton';
import { useAccountTheme } from '@/hooks/useAccountTheme';
import { useSessionBootstrap } from '@/hooks/useSession';
import { useSystemThemeSync } from '@/hooks/useSystemThemeSync';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AccountClosedPage } from '@/pages/AccountClosedPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { VerifyEmailPage } from '@/pages/VerifyEmailPage';
import { MarketingRoute } from '@/routes/MarketingRoute';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PublicOnlyRoute } from '@/routes/PublicOnlyRoute';
import { paths } from '@/routes/paths';

/**
 * Every heavy route is lazy, and that is a bundle requirement rather than a
 * preference.
 *
 * SPEC section 12 caps the landing route at 150 KB gzipped and forbids Chart.js,
 * dnd-kit and the markdown pair from reaching it. `manualChunks` alone does not
 * achieve that: it puts those libraries in their own chunks, but a *static*
 * import from this file would still make the browser fetch them on every route,
 * `/` included. A dynamic import is what actually severs them.
 *
 *   - Dashboard      -> chart-vendor
 *   - Board          -> dnd
 *   - ApplicationDetail, Terms, Privacy -> markdown
 *
 * `scripts/checkBundle.mjs` walks the built manifest and fails the build if any
 * of them reappears in the landing route closure.
 */
const LandingPage = lazy(async () => import('@/pages/LandingPage'));
const SettingsPage = lazy(async () => import('@/pages/SettingsPage'));
const TermsPage = lazy(async () => import('@/pages/TermsPage'));
const PrivacyPage = lazy(async () => import('@/pages/PrivacyPage'));
const DashboardPage = lazy(async () => import('@/pages/DashboardPage'));
const ApplicationDetailPage = lazy(async () => import('@/pages/ApplicationDetailPage'));
const BoardPage = lazy(async () => import('@/pages/BoardPage'));
const ApplicationsPage = lazy(async () => import('@/pages/ApplicationsPage'));
const CalendarPage = lazy(async () => import('@/pages/CalendarPage'));

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
      {/*
        The public surface. `MarketingRoute` is the one place SPEC section 12's
        "logged-in users hitting / go straight to the dashboard" is decided.
      */}
      <Route element={<MarketingRoute />}>
        <Route
          path={paths.landing}
          element={
            <Suspense fallback={<RouteSkeleton />}>
              <LandingPage />
            </Suspense>
          }
        />
        <Route
          path={paths.terms}
          element={
            <Suspense fallback={<RouteSkeleton />}>
              <TermsPage />
            </Suspense>
          }
        />
        <Route
          path={paths.privacy}
          element={
            <Suspense fallback={<RouteSkeleton />}>
              <PrivacyPage />
            </Suspense>
          }
        />
      </Route>

      <Route element={<PublicOnlyRoute />}>
        <Route path={paths.login} element={<LoginPage />} />
        <Route path={paths.register} element={<RegisterPage />} />
        <Route path={paths.forgotPassword} element={<ForgotPasswordPage />} />
        <Route path={paths.resetPassword} element={<ResetPasswordPage />} />
      </Route>

      {/*
        Verification and the closed-account notice sit outside every guard. A
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
          <Route
            path={paths.applications}
            element={
              <Suspense fallback={<RouteSkeleton />}>
                <ApplicationsPage />
              </Suspense>
            }
          />
          <Route
            path={paths.board}
            element={
              <Suspense fallback={<RouteSkeleton />}>
                <BoardPage />
              </Suspense>
            }
          />
          <Route
            path={paths.calendar}
            element={
              <Suspense fallback={<RouteSkeleton />}>
                <CalendarPage />
              </Suspense>
            }
          />
          <Route
            path="/applications/:applicationId"
            element={
              <Suspense fallback={<RouteSkeleton />}>
                <ApplicationDetailPage />
              </Suspense>
            }
          />
          <Route
            path={paths.settings}
            element={
              <Suspense fallback={<RouteSkeleton />}>
                <SettingsPage />
              </Suspense>
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
