/**
 * The landing page's content sections below the hero, per SPEC section 12: the
 * feature matrix, a product screenshot, and a "how it works" strip.
 *
 * Everything here is markup and Tailwind tokens. Nothing imports a chart, a drag
 * library or the markdown renderer, which is what keeps this route's chunk clear
 * of them — enforced for real by `scripts/checkBundle.mjs` rather than left to
 * convention.
 */

// Written by `scripts/captureScreenshot.mjs` alongside the images it describes.
import dashboardScreenshot from '@/components/marketing/dashboardScreenshot.json';

interface Feature {
  title: string;
  body: string;
  /** Inline path data, so a feature icon costs no request and no icon library. */
  icon: string;
}

const FEATURES: Feature[] = [
  {
    title: 'A board that matches how you think',
    body: 'Drag an application from Applied to Interview to Offer. Every move saves instantly and is recorded in its history, so you can see when each move happened.',
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
    body: 'Response rate, interview rate, time to first reply, a funnel, and where your applications come from. Numbers about your search, not vanity counters.',
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
    <section aria-labelledby="features-heading" className="marketing-shell py-16">
      <h2
        id="features-heading"
        className="max-w-[18ch] text-display-md stretch-wide text-content sm:max-w-none"
      >
        Everything the spreadsheet was missing
      </h2>

      {/*
        One matrix, not six floating cards. The container draws the outer frame
        and each cell draws its own right and bottom rule, so the borders meet
        as a single grid of hairlines instead of six separate outlines with the
        same soft shadow under each.

        Every cell is the same size: six features tile 2 x 3 at `sm` and 3 x 2
        at `lg` with nothing left over. From `sm`, `auto-rows-fr` makes every
        row as tall as the tallest card, and content stays top-aligned inside
        it, so a short blurb leaves space under itself rather than a gap in the
        frame. A phone's single column keeps natural heights: equal rows there
        would only pad the short cards with empty space.
      */}
      <ul className="mt-10 grid overflow-hidden sm:auto-rows-fr rounded-panel border-l border-t border-border sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="border-b border-r border-border bg-surface p-6 sm:p-7">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 text-primary"
            >
              <path d={feature.icon} />
            </svg>
            <h3 className="mt-5 text-base font-semibold tracking-tight text-content">
              {feature.title}
            </h3>
            <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-content-muted nums-proportional">
              {feature.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SCREENSHOT_ALT =
  'The Internship Tracker dashboard, showing stat cards for applications, interviews and offers, response rate, interview rate and time to first reply, a chart of applications over time, and a list of upcoming interviews and deadlines.';

const SCREENSHOTS = [
  { theme: 'light', className: 'block dark:hidden' },
  { theme: 'dark', className: 'hidden dark:block' },
] as const;

export function ScreenshotSection(): JSX.Element {
  return (
    <section aria-labelledby="screenshot-heading" className="border-y border-border bg-surface">
      <div className="marketing-shell py-16">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-10">
          <h2
            id="screenshot-heading"
            className="text-display-md stretch-wide text-content lg:col-span-6"
          >
            Your whole search, on one screen
          </h2>
          <p className="max-w-[56ch] text-sm leading-relaxed text-content-muted nums-proportional lg:col-span-6">
            What you sent, who replied and what is due next, side by side.
          </p>
        </div>

        {/*
          One capture per theme, swapped by `dark:`, which keys off the same
          `data-theme` attribute the theme control sets — so the picture follows
          the visitor's explicit choice, not only their OS setting. The hidden
          one is `display: none`, and a lazy image that is never rendered is
          never fetched, so a visitor downloads one screenshot, not two.
        */}
        <figure className="mt-10">
          {SCREENSHOTS.map(({ theme, className }) => (
            <img
              key={theme}
              src={`/screenshot-dashboard-${theme}.png`}
              alt={SCREENSHOT_ALT}
              width={dashboardScreenshot.width}
              height={dashboardScreenshot.height}
              loading="lazy"
              decoding="async"
              className={`${className} w-full rounded-panel border border-border`}
            />
          ))}
          <figcaption className="mt-3 text-xs leading-relaxed text-content-subtle">
            The same view the demo account opens on.
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
    <section aria-labelledby="how-heading" className="marketing-shell py-16">
      <h2 id="how-heading" className="text-display-md stretch-wide text-content">
        How it works
      </h2>

      {/*
        Numbered because this genuinely is a sequence — the markers carry the
        order rather than decorating three equal points. Each step hangs off a
        rule, so the row reads as one rail rather than three separate cards.
      */}
      <ol className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-6">
        {STEPS.map((step, index) => (
          <li key={step.title} className="border-t-2 border-border-strong pt-5">
            <span className="block text-display-sm stretch-display text-primary">{index + 1}</span>
            <h3 className="mt-3 text-base font-semibold tracking-tight text-content">
              {step.title}
            </h3>
            <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-content-muted nums-proportional">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
