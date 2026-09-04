import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { APP_TAGLINE } from '@/lib/siteMeta';
import { paths } from '@/routes/paths';

/**
 * The landing page's content sections, per SPEC section 12: hero, feature cards,
 * a product screenshot, and a "how it works" strip.
 *
 * Everything here is markup and Tailwind tokens. Nothing imports a chart, a drag
 * library or the markdown renderer, which is what keeps this route's chunk clear
 * of them — enforced for real by `scripts/checkBundle.mjs` rather than left to
 * convention.
 */

interface HeroProps {
  onTryDemo: () => void;
  isDemoLoading: boolean;
  showDemo: boolean;
}

export function Hero({ onTryDemo, isDemoLoading, showDemo }: HeroProps): JSX.Element {
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">
          Free and open source
        </p>
        <h1 className="mx-auto mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-content sm:text-5xl">
          {APP_TAGLINE}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-content-muted sm:text-lg">
          Spreadsheets lose track of where you applied and when you have to hear back. This keeps
          every application, interview and deadline in one place, and emails you before anything
          slips.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to={paths.register}
            className="inline-flex h-11 w-full items-center justify-center rounded-control bg-primary px-6 text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover sm:w-auto"
          >
            Start tracking — it&apos;s free
          </Link>
          {showDemo ? (
            <Button
              variant="secondary"
              onClick={onTryDemo}
              isLoading={isDemoLoading}
              loadingLabel="Opening the demo"
              className="w-full sm:w-auto"
            >
              Try the demo
            </Button>
          ) : null}
        </div>

        <p className="mt-4 text-xs text-content-subtle">
          No credit card. The demo needs no sign-up at all.
        </p>
      </div>
    </section>
  );
}

interface Feature {
  title: string;
  body: string;
  /** Inline path data, so a feature icon costs no request and no icon library. */
  icon: string;
}

const FEATURES: Feature[] = [
  {
    title: 'A board that matches how you think',
    body: 'Drag an application from Applied to Interview to Offer. Every move saves instantly and is recorded in its history, so you can see how long each stage really took.',
    icon: 'M4 5h5v14H4zM10 5h5v9h-5zM16 5h4v6h-4z',
  },
  {
    title: 'Deadlines on a calendar',
    body: 'Application deadlines and interview times on a month view, in your own timezone, so a 9am slot is 9am where you actually are.',
    icon: 'M7 3v2m10-2v2M4 8h16M5 5h14v15H5z',
  },
  {
    title: 'Reminders that arrive in the morning',
    body: 'One digest of what is due, sent at 8am on your clock rather than the server one. Switch it off in a single click from any message.',
    icon: 'M3 6h18v12H3zM3 7l9 6 9-6',
  },
  {
    title: 'Statistics worth reading',
    body: 'Response rate, interview rate, time to first reply, a funnel, and which sources actually convert. Numbers about your search, not vanity counters.',
    icon: 'M4 19V9m5 10V5m5 14v-7m5 7V7',
  },
  {
    title: 'Files where they belong',
    body: 'Attach the CV and cover letter you actually sent to each application, so you always know which version went where.',
    icon: 'M14 3v5h5M7 3h8l5 5v13H7zM10 13h6M10 17h4',
  },
  {
    title: 'Your data stays yours',
    body: 'Export everything as JSON at any time, and delete your account whenever you like. Nothing is sold, shared, or used to train anything.',
    icon: 'M12 3l8 4v5c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V7zM9 12l2 2 4-4',
  },
];

export function FeatureCards(): JSX.Element {
  return (
    <section aria-labelledby="features-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2
        id="features-heading"
        className="text-center text-2xl font-semibold tracking-tight text-content sm:text-3xl"
      >
        Everything the spreadsheet was missing
      </h2>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <li
            key={feature.title}
            className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong"
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d={feature.icon} />
              </svg>
            </span>
            <h3 className="mt-4 text-base font-semibold text-content">{feature.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-content-muted">{feature.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ScreenshotSection(): JSX.Element {
  return (
    <section aria-labelledby="screenshot-heading" className="border-y border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2
          id="screenshot-heading"
          className="text-center text-2xl font-semibold tracking-tight text-content sm:text-3xl"
        >
          Your whole search, on one screen
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-content-muted">
          The dashboard after a couple of months of applying — the same view the demo account opens
          on.
        </p>

        <figure className="mt-10">
          <img
            src="/screenshot-dashboard.png"
            alt="The Internship Tracker dashboard, showing stat cards for applications sent, response rate and interviews, a status funnel, and a list of upcoming deadlines."
            width={2400}
            height={1400}
            loading="lazy"
            decoding="async"
            className="mx-auto w-full max-w-4xl rounded-xl border border-border shadow-sm"
          />
          <figcaption className="mt-3 text-center text-xs text-content-subtle">
            Dark mode included, and every view works down to a phone.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: 'Add an application',
    body: 'Company, role, and the deadline. Thirty seconds, and it is off your mind.',
  },
  {
    title: 'Move it as things happen',
    body: 'Drag it across the board as you hear back. The history records itself.',
  },
  {
    title: 'Let it remind you',
    body: 'A morning email when something is due, and a weekly summary if you want one.',
  },
];

export function HowItWorks(): JSX.Element {
  return (
    <section aria-labelledby="how-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2
        id="how-heading"
        className="text-center text-2xl font-semibold tracking-tight text-content sm:text-3xl"
      >
        How it works
      </h2>

      <ol className="mt-10 grid gap-6 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="text-center sm:text-left">
            <span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-fg sm:mx-0">
              {index + 1}
            </span>
            <h3 className="mt-4 text-base font-semibold text-content">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-content-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
