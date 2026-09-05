import { Button } from '@/components/ui/Button';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { useExportAccount } from '@/features/settings/useAccountData';

/**
 * Taking your data with you.
 *
 * Until Phase 14 this section rendered two disabled buttons and said neither
 * action existed yet, which had stopped being true for deletion the moment Phase
 * 11 shipped `DangerZoneSection`. Deletion now lives there and only there - one
 * affordance for one action - and this section owns the export, which is real.
 *
 * The copy states exactly what the file contains, because SPEC section 12 makes
 * a promise about it on the privacy page and a vaguer description here would be
 * the place the promise quietly stopped being kept.
 */
export function DataSection(): JSX.Element {
  const exportAccount = useExportAccount();

  return (
    <SettingsSection
      title="Your data"
      description="Everything this account holds, in one file you can keep."
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-content">Export all my data</h3>
          <p className="mt-0.5 text-sm text-content-muted">
            One JSON file with your profile, every application and its interviews, notes and status
            history, every reminder, and the record of each signed-in device.
          </p>
          <p className="mt-1 text-xs text-content-subtle">
            Attachments are listed with their name, type and size; download the files themselves
            from each application. Passwords and session tokens are never included.
          </p>
        </div>

        <Button
          variant="secondary"
          isLoading={exportAccount.isPending}
          loadingLabel="Preparing"
          onClick={() => {
            exportAccount.mutate();
          }}
        >
          Export
        </Button>
      </div>
    </SettingsSection>
  );
}
