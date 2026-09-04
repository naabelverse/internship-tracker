import { Button } from '@/components/ui/Button';
import { SettingsSection } from '@/features/settings/SettingsSection';

/**
 * The two account-level actions SPEC section 12 requires, as affordances only.
 *
 * Neither endpoint exists yet, and both are the kind of thing that must not be
 * half-built:
 *
 *  - **Export all my data** needs a single document containing everything the
 *    system holds about the account. `GET /applications/export` covers only the
 *    applications, so shipping it under this label would quietly under-deliver
 *    on a promise the privacy page will make. Phase 14.
 *  - **Delete my account** needs the soft delete, the 30 day purge and the
 *    typed-confirmation flow. A button that deletes without that machinery is
 *    worse than no button. Phase 11 and 14.
 *
 * They are rendered disabled with the reason stated rather than hidden, because
 * a user looking for "how do I get my data out" needs to find the answer here
 * even while the answer is "not yet".
 */
export function DataSection(): JSX.Element {
  return (
    <SettingsSection
      title="Your data"
      description="Take everything with you, or close the account for good."
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-content">Export all my data</h3>
          <p className="mt-0.5 text-sm text-content-muted">
            One JSON file with your profile, every application, interview, reminder and attachment
            record.
          </p>
          <p className="mt-1 text-xs text-content-subtle">
            Not available yet. Until then, the applications table can export your applications on
            their own as CSV or JSON.
          </p>
        </div>
        <Button variant="secondary" disabled aria-describedby="export-status">
          Export
        </Button>
        <span id="export-status" className="sr-only">
          Full account export is not available yet
        </span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-content">Delete my account</h3>
          <p className="mt-0.5 text-sm text-content-muted">
            Removes your account and everything in it. This cannot be undone.
          </p>
          <p className="mt-1 text-xs text-content-subtle">
            Not available yet. Deleting needs the confirmation and purge flow that arrives with the
            account lifecycle work.
          </p>
        </div>
        <Button variant="danger" disabled aria-describedby="delete-status">
          Delete account
        </Button>
        <span id="delete-status" className="sr-only">
          Account deletion is not available yet
        </span>
      </div>
    </SettingsSection>
  );
}
