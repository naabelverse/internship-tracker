import { Button } from '@/components/ui/Button';
import { CheckIcon } from '@/components/ui/icons';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { useExportAccount } from '@/features/settings/useAccountData';

/** What the export holds, mirroring what the export service actually writes. */
const INCLUDED = [
  'Your profile',
  'Every application and its interviews, notes and status history',
  'Every reminder',
  'Each signed-in device',
] as const;

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
      description="Export everything this account holds as one JSON file you can keep."
      footer={
        <Button
          isLoading={exportAccount.isPending}
          loadingLabel="Preparing"
          onClick={() => {
            exportAccount.mutate();
          }}
        >
          Export
        </Button>
      }
    >
      <ul className="space-y-2 text-sm text-content">
        {INCLUDED.map((item) => (
          <li key={item} className="flex items-start gap-2.5">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-content-subtle" />
            {item}
          </li>
        ))}
      </ul>

      <p className="text-xs text-content-subtle">
        Attachments are listed with their name, type and size; download the files from each
        application. Passwords and session tokens are never included.
      </p>
    </SettingsSection>
  );
}
