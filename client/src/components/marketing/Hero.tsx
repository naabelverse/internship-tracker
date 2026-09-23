import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { StatusDot } from '@/components/ui/StatusDot';
import { EVENT_KIND_CONFIG, STATUS_CONFIG } from '@/lib/statusConfig';
import { paths } from '@/routes/paths';
import { APPLICATION_STATUSES } from '@/types/application';
import type { CalendarEvent } from '@/types/calendar';

/**
 * The landing hero, per SPEC section 12.
 *
 * The design direction is recorded in DECISIONS.md: this is an operations board,
 * not a marketing page. So the hero is asymmetric and left-aligned rather than
 * centred, and the thing carrying it is the product's own core object — a list
 * of what is due next — rather than an icon, an illustration or a gradient.
 *
 * Nothing here imports a chart, a drag library or the markdown renderer, which
 * is what keeps this route's chunk clear of them. `scripts/checkBundle.mjs`
 * enforces that for real rather than leaving it to convention.
 */

interface HeroProps {
  onTryDemo: () => void;
  isDemoLoading: boolean;
  showDemo: boolean;
}

interface ExampleRow {
  company: string;
  role: string;
  /** What the dashboard's upcoming panel marks a row by: the event, not the status. */
  kind: CalendarEvent['kind'];
  due: string;
  /** Inside three days, which is where the dashboard turns the date amber. */
  urgent?: boolean;
}

/**
 * Sample rows for the panel.
 *
 * Deliberately a realistic mix rather than "Company A / Role B": the panel is
 * making the claim that this is what your week looks like, and placeholder names
 * would undercut it.
 */
const EXAMPLE_ROWS: ExampleRow[] = [
  {
    company: 'Stripe',
    role: 'Software Engineering Intern',
    kind: 'interview',
    due: 'in 2 days',
    urgent: true,
  },
  { company: 'Razorpay', role: 'Backend Intern', kind: 'deadline', due: 'in 4 days' },
  { company: 'Zomato', role: 'Data Analyst Intern', kind: 'interview', due: 'in 6 days' },
  { company: 'Notion', role: 'Product Design Intern', kind: 'deadline', due: 'in 11 days' },
];

/** The deadline list, as it would look mid-search. */
function DispatchPanel(): JSX.Element {
  return (
    <figure className="m-0">
      <div className="atmos-lit overflow-hidden rounded-panel border border-border bg-surface shadow-float">
        <div className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
          <p className="text-sm font-semibold tracking-tight text-content">Next up</p>
          <p className="text-xs text-content-subtle">12 open</p>
        </div>

        <ul className="divide-y divide-border">
          {EXAMPLE_ROWS.map((row) => {
            const kind = EVENT_KIND_CONFIG[row.kind];

            return (
              <li
                key={row.company}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3.5 sm:px-5"
              >
                <p className="truncate text-sm font-semibold tracking-tight text-content">
                  {row.company}
                </p>
                <p
                  className={`text-right text-xs font-semibold ${
                    row.urgent === true ? 'text-warning' : 'text-content-subtle'
                  }`}
                >
                  {row.due}
                </p>
                <p className="truncate text-xs text-content-muted">{row.role}</p>
                <p className="flex items-center justify-end gap-1.5 text-xs text-content-muted">
                  <span
                    data-event-dot={row.kind}
                    aria-hidden="true"
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${kind.dot}`}
                  />
                  {kind.label}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      <figcaption className="mt-3 text-xs leading-relaxed text-content-subtle nums-proportional">
        An example week. Amber is the only colour that means hurry.
      </figcaption>
    </figure>
  );
}

/**
 * The eight statuses, in the order an application moves through them.
 *
 * It doubles as the page's colour legend and as a plain statement of what the
 * product tracks, which is more useful than a row of adjectives would be.
 */
function PipelineRail(): JSX.Element {
  return (
    <ul className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-7 sm:mt-14 sm:gap-x-7">
      {APPLICATION_STATUSES.map((status) => (
        <li key={status} className="flex items-center gap-2 text-xs text-content-muted">
          <StatusDot status={status} size="xs" />
          {STATUS_CONFIG[status].label}
        </li>
      ))}
    </ul>
  );
}

export function Hero({ onTryDemo, isDemoLoading, showDemo }: HeroProps): JSX.Element {
  return (
    <section className="atmos-field border-b border-border">
      <div className="marketing-shell py-16 sm:py-24 lg:py-28">
        <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-6">
            <h1 className="max-w-[13ch] text-display-lg stretch-display text-content">
              Never miss a deadline you worked this hard for.
            </h1>

            <p className="mt-6 max-w-[54ch] text-base leading-relaxed text-content-muted nums-proportional sm:text-[1.0625rem]">
              A spreadsheet stops keeping up somewhere around application number twelve. This keeps
              every application, interview and deadline in one place, in your own timezone, and
              sends one digest at 8am when something is actually due.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                to={paths.register}
                className="inline-flex h-11 items-center justify-center rounded-control bg-primary-fill px-6 text-sm font-semibold text-primary-fill-fg transition-colors hover:bg-primary-fill-hover"
              >
                Create a free account
              </Link>
              {showDemo ? (
                <Button
                  variant="secondary"
                  onClick={onTryDemo}
                  isLoading={isDemoLoading}
                  loadingLabel="Opening the demo"
                >
                  Try the demo
                </Button>
              ) : null}
            </div>

            <p className="mt-3 text-xs text-content-subtle nums-proportional">
              No card, no trial, no paid tier. The demo needs no sign-up at all.
            </p>
          </div>

          <div className="lg:col-span-6 lg:pt-2">
            <DispatchPanel />
          </div>
        </div>

        <PipelineRail />
      </div>
    </section>
  );
}
