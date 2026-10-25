import { Seo } from '@/components/Seo';
import { FaqAccordion } from '@/components/marketing/FaqAccordion';
import { Hero } from '@/components/marketing/Hero';
import {
  FeatureCards,
  HowItWorks,
  ScreenshotSection,
} from '@/components/marketing/LandingSections';
import { MarketingShell } from '@/components/marketing/MarketingChrome';
import { useDemoLogin } from '@/features/auth/useAuthMutations';
import { clientEnv } from '@/lib/env';
import { APP_DESCRIPTION } from '@/lib/siteMeta';

/**
 * The public landing page at `/`, per SPEC section 12.
 *
 * A signed-in visitor never reaches it - `MarketingRoute` redirects them to the
 * dashboard before this renders - so there is no session check anywhere here.
 *
 * The whole page is static markup plus one mutation. That is deliberate: this is
 * the route with the tightest bundle budget, so it imports nothing from the
 * dashboard, board or calendar trees.
 */
export default function LandingPage(): JSX.Element {
  const demoLogin = useDemoLogin();

  return (
    <MarketingShell signUpCard>
      <Seo
        standaloneTitle
        title="Internship Tracker - never miss an application deadline"
        description={APP_DESCRIPTION}
      />

      <Hero
        showDemo={clientEnv.demoEnabled}
        isDemoLoading={demoLogin.isPending}
        onTryDemo={() => {
          demoLogin.mutate();
        }}
      />
      <FeatureCards />
      <ScreenshotSection />
      <HowItWorks />
      <FaqAccordion />
    </MarketingShell>
  );
}
