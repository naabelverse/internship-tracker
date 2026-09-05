import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RouteSkeleton } from '@/components/layout/RouteSkeleton';
import { DashboardSkeleton } from '@/features/dashboard/DashboardSkeleton';
import { useAccountTheme } from '@/hooks/useAccountTheme';
import { useSessionBootstrap } from '@/hooks/useSession';
import { useSystemThemeSync } from '@/hooks/useSystemThemeSync';
import { MarketingRoute } from '@/routes/MarketingRoute';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PublicOnlyRoute } from '@/routes/PublicOnlyRoute';
import { paths } from '@/routes/paths';

/**
 * Every route is lazy. SPEC section 12 asks for route-level code splitting, and
 * on the heavy routes it is a hard bundle requirement rather than a preference.
 *
 * The landing route is capped at 150 KB gzipped and must not reach Chart.js,
 * dnd-kit or the markdown pair. `manualChunks` does not achieve that on its own:
 * it puts those libraries in their own chunks, but a *static* import from this
 * file would still make the browser fetch them on every route, `/` included. The
 * dynamic import is what actually severs them.
 *
 *   - Dashboard      -> chart-vendor
 *   - Board          -> dnd
 *   - ApplicationDetail, Terms, Privacy -> markdown
 *
 * The seven auth and error routes carry no such library, so splitting them is
 * about the shared entry chunk rather than isolation: eager, their page code sat
 * in `index.js` and every visitor downloaded all seven to see one of them.
 *
 * Phase 13 held those seven back, believing full lazy loading had destabilised
 * 25 tests. Phase 15 reproduced it and the belief was wrong: the failures are
 * RTL's default 1 s `asyncUtilTimeout`, and the identical set fails with these
 * routes eager. `tests/setup.ts` is what fixed them. See DECISIONS.md.
 *
 * `scripts/checkBundle.mjs` walks the built manifest and fails the build if a
 * forbidden library reappears in the landing route's static closure.
 */
const LandingPage = lazy(async () => import('@/pages/LandingPage'));
const TermsPage = lazy(async () => import('@/pages/TermsPage'));
const PrivacyPage = lazy(async () => import('@/pages/PrivacyPage'));
const DashboardPage = lazy(async () => import('@/pages/DashboardPage'));
const ApplicationsPage = lazy(async () => import('@/pages/ApplicationsPage'));
const ApplicationDetailPage = lazy(async () => import('@/pages/ApplicationDetailPage'));
const BoardPage = lazy(async () => import('@/pages/BoardPage'));
const CalendarPage = lazy(async () => import('@/pages/CalendarPage'));
const SettingsPage = lazy(async () => import('@/pages/SettingsPage'));
const LoginPage = lazy(async () => import('@/pages/LoginPage'));
const RegisterPage = lazy(async () => import('@/pages/RegisterPage'));
const ForgotPasswordPage = lazy(async () => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(async () => import('@/pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(async () => import('@/pages/VerifyEmailPage'));
const AccountClosedPage = lazy(async () => import('@/pages/AccountClosedPage'));
const NotFoundPage = lazy(async () => import('@/pages/NotFoundPage'));

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
        <Route
          path={paths.login}
          element={
            <Suspense fallback={<RouteSkeleton />}>
              <LoginPage />
            </Suspense>
          }
        />
        <Route
          path={paths.register}
          element={
            <Suspense fallback={<RouteSkeleton />}>
              <RegisterPage />
            </Suspense>
          }
        />
        <Route
          path={paths.forgotPassword}
          element={
            <Suspense fallback={<RouteSkeleton />}>
              <ForgotPasswordPage />
            </Suspense>
          }
        />
        <Route
          path={paths.resetPassword}
          element={
            <Suspense fallback={<RouteSkeleton />}>
              <ResetPasswordPage />
            </Suspense>
          }
        />
      </Route>

      {/*
        Verification and the closed-account notice sit outside every guard. A
        confirmation link is followed from an email on whatever device happens to
        be to hand, signed in or not, and the closed-account page is reached at
        the exact moment the session has just been cleared.
      */}
      <Route
        path={paths.verifyEmail}
        element={
          <Suspense fallback={<RouteSkeleton />}>
            <VerifyEmailPage />
          </Suspense>
        }
      />
      <Route
        path={paths.accountClosed}
        element={
          <Suspense fallback={<RouteSkeleton />}>
            <AccountClosedPage />
          </Suspense>
        }
      />

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

      <Route
        path="*"
        element={
          <Suspense fallback={<RouteSkeleton />}>
            <NotFoundPage />
          </Suspense>
        }
      />
    </Routes>
  );
}
