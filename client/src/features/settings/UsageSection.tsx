import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { useAccountUsage } from '@/features/settings/useAccountData';
import type { UsageCounter } from '@/api/account';

const BYTES_PER_MB = 1024 * 1024;

/** Whole numbers below a megabyte read as noise, so small figures keep a decimal. */
function formatBytes(bytes: number): string {
  const megabytes = bytes / BYTES_PER_MB;

  if (megabytes < 0.1 && bytes > 0) return '<0.1 MB';

  return `${megabytes.toFixed(megabytes >= 10 || megabytes === 0 ? 0 : 1)} MB`;
}

function percentage({ used, limit }: UsageCounter): number {
  return limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
}

interface MeterProps {
  label: string;
  description: string;
  counter: UsageCounter;
  format: (value: number) => string;
}

/**
 * One quota row.
 *
 * The bar is decorative and hidden from assistive technology; the figures next
 * to it are the real content, and they are read out as text rather than as a
 * percentage nobody can act on. The bar turns amber past 80% and red past 95%,
 * which is early enough to do something about it before a write is refused.
 */
function Meter({ label, description, counter, format }: MeterProps): JSX.Element {
  const percent = percentage(counter);
  const tone = percent >= 95 ? 'bg-danger' : percent >= 80 ? 'bg-warning' : 'bg-primary';

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-content">{label}</h3>
        <p className="text-sm tabular-nums text-content-muted">
          {`${format(counter.used)} of ${format(counter.limit)}`}
        </p>
      </div>

      <div
        aria-hidden="true"
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${String(percent)}%` }} />
      </div>

      <p className="mt-1.5 text-xs text-content-subtle">
        {`${description} ${format(counter.remaining)} remaining.`}
      </p>
    </div>
  );
}

/**
 * SPEC section 12 caps an account at 2000 applications, 100 MB of uploads and 20
 * attachments on any one application, and asks for the usage to be surfaced.
 *
 * It is a section of its own rather than a line inside "Your data" because the
 * limits are the reason a write can be refused: a user who hits one needs to
 * find out here, before the refusal, not from a 403 on the form they just
 * filled in. The numbers come from the server, which is also what enforces them.
 */
export function UsageSection(): JSX.Element {
  const usage = useAccountUsage();

  return (
    <SettingsSection
      title="Storage and limits"
      description="What this account is using, and the ceilings it is measured against."
    >
      {usage.isPending && (
        <div className="space-y-5">
          <Skeleton className="h-12 w-full" label="Loading your usage" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {usage.isError && (
        <ErrorState
          error={usage.error}
          fallback="Your usage could not be loaded."
          onRetry={() => {
            void usage.refetch();
          }}
        />
      )}

      {usage.data && (
        <div className="space-y-5">
          <Meter
            label="Applications"
            description="Tracked applications on this account."
            counter={usage.data.applications}
            format={(value) => value.toLocaleString()}
          />

          <Meter
            label="Uploads"
            description="Every attachment across every application."
            counter={usage.data.storageBytes}
            format={formatBytes}
          />

          <p className="text-xs text-content-subtle">
            Any one application can carry up to{' '}
            {usage.data.attachmentsPerApplication.limit.toLocaleString()} attachments. Reaching a
            limit does not affect anything already saved - it only stops new records being added
            until you remove some.
          </p>
        </div>
      )}
    </SettingsSection>
  );
}
