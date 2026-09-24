import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatPurgeDate, type PendingDeletion } from '@/features/auth/accountClosure';

interface RestoreAccountDialogProps {
  pending: PendingDeletion | null;
  isRestoring: boolean;
  onRestore: () => void;
  /** Also what Escape and the backdrop do: leaving the account closed is the safe default. */
  onKeepClosed: () => void;
}

/**
 * Asked after a correct password on a closed account. Nothing is restored until
 * the user chooses to; dismissing the dialog in any way leaves the account
 * closed and the purge date unchanged.
 */
export function RestoreAccountDialog({
  pending,
  isRestoring,
  onRestore,
  onKeepClosed,
}: RestoreAccountDialogProps): JSX.Element {
  const date = pending ? formatPurgeDate(pending.purgeAt) : '';

  return (
    <Modal
      isOpen={pending !== null}
      onClose={onKeepClosed}
      title="Your account is closed"
      description={`Your account is scheduled for deletion on ${date}. Restore it?`}
      footer={
        <>
          <Button variant="secondary" onClick={onKeepClosed} disabled={isRestoring}>
            Keep it closed
          </Button>
          <Button onClick={onRestore} isLoading={isRestoring} loadingLabel="Restoring">
            Restore my account
          </Button>
        </>
      }
    >
      <p className="text-sm text-content-muted">
        Your applications, interviews, notes, files and reminders come back as you left them.
        Reminders that came due while the account was closed won&rsquo;t be sent. Other devices stay
        signed out.
      </p>
    </Modal>
  );
}
