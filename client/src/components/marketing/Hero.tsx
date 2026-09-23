import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { UpcomingRow } from '@/features/dashboard/UpcomingRow';
import { cn } from '@/lib/cn';
import { EVENT_KIND_CONFIG } from '@/lib/statusConfig';
import { paths } from '@/routes/paths';
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

interface ExampleEvent {
  company: string;
  role: string;
  kind: CalendarEvent['kind'];
  /** Whole days from now. The panel dates itself when it renders, so it never goes stale. */
  inDays: number;
}

/**
 * Sample rows for the panel.
 *
 * Deliberately a realistic mix rather than "Company A / Role B": the panel is
 * making the claim that this is what your week looks like, and placeholder names
 * would undercut it.
 */
const EXAMPLE_EVENTS: ExampleEvent[] = [
  { company: 'Stripe', role: 'Software Engineering Intern', kind: 'interview', inDays: 2 },
  { company: 'Razorpay', role: 'Backend Intern', kind: 'deadline', inDays: 4 },
  { company: 'Zomato', role: 'Data Analyst Intern', kind: 'interview', inDays: 6 },
  { company: 'Notion', role: 'Product Design Intern', kind: 'deadline', inDays: 11 },
];

const MS_PER_DAY = 86_400_000;

/**
 * The example's instant, on the hour so the absolute time reads like a real
 * booking. Dropping the minutes takes less than an hour off a whole number of
 * days, which the relative date still rounds back to the same "in N days".
 */
function exampleAt(inDays: number, now: Date): string {
  const at = new Date(now.getTime() + inDays * MS_PER_DAY);
  at.setMinutes(0, 0, 0);
  return at.toISOString();
}

const EVENT_KINDS = Object.keys(EVENT_KIND_CONFIG) as CalendarEvent['kind'][];

/**
 * What the panel's dots mean. They mark the event, not the application's
 * status: an interview row is blue, where the Interview status is amber. So
 * this keys the two colours the panel actually uses, drawn the same size as the
 * rows' dots, and the page carries no status legend to read them against.
 */
function EventKindKey(): JSX.Element {
  return (
    <ul
      aria-label="What the dots mean"
      className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2"
    >
      {EVENT_KINDS.map((kind) => (
        <li key={kind} className="flex items-center gap-2 text-xs text-content-muted">
          <span
            className={cn('h-2 w-2 shrink-0 rounded-full', EVENT_KIND_CONFIG[kind].dot)}
            aria-hidden="true"
          />
          {EVENT_KIND_CONFIG[kind].label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The dashboard's upcoming panel, as it would look mid-search. Each row is the
 * dashboard's own `UpcomingRow`, so the date wording, the amber and the dot are
 * whatever the product does today rather than a copy of it.
 */
function DispatchPanel(): JSX.Element {
  const now = new Date();

  return (
    <figure className="m-0">
      <div className="atmos-lit overflow-hidden rounded-panel border border-border bg-surface shadow-float">
        <div className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
          <p className="text-sm font-semibold tracking-tight text-content">Next up</p>
          <p className="text-xs text-content-subtle">12 open</p>
        </div>

        <ul className="divide-y divide-border">
          {EXAMPLE_EVENTS.map((example) => (
            <li key={example.company} className="px-4 sm:px-5">
              <UpcomingRow event={{ ...example, at: exampleAt(example.inDays, now) }} />
            </li>
          ))}
        </ul>
      </div>

      <EventKindKey />

      <figcaption className="mt-3 text-xs leading-relaxed text-content-subtle nums-proportional">
        An example week. Amber and red mean it needs attention.
      </figcaption>
    </figure>
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

          <div className="lg:col-span-6 lg:self-center">
            <DispatchPanel />
          </div>
        </div>
      </div>
    </section>
  );
}
