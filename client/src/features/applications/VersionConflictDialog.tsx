import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatDateTime } from '@/lib/formatters';
import { STATUS_CONFIG } from '@/lib/statusConfig';
import type { VersionConflict } from '@/types/application';

interface VersionConflictDialogProps {
  conflict: VersionConflict | null;
  isPending: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onDismiss: () => void;
}

const SOURCE_EXPLANATION: Record<VersionConflict['conflictSource'], string> = {
  stale_read: 'You were editing a version that had already been replaced.',
  concurrent_write: 'Another change was saved while you had this form open.',
};

/**
 * SPEC section 7: a 409 from the optimistic lock is a decision the user has to
 * make, not an error to acknowledge. It shows what is on the server now and
 * offers the two ways out — take theirs, or force yours over the top.
 */
export function VersionConflictDialog({
  conflict,
  isPending,
  onReload,
  onOverwrite,
  onDismiss,
}: VersionConflictDialogProps): JSX.Element | null {
  if (!conflict) return null;

  const { current } = conflict;

  return (
    <Modal
      isOpen
      onClose={onDismiss}
      title="This was changed elsewhere"
      description={SOURCE_EXPLANATION[conflict.conflictSource]}
      footer={
        <>
          <Button variant="secondary" onClick={onReload}>
            Discard mine and reload
          </Button>
          <Button onClick={onOverwrite} isLoading={isPending} loadingLabel="Overwriting">
            Overwrite with my changes
          </Button>
        </>
      }
    >
      {current ? (
        <div className="space-y-3">
          <p className="text-sm text-content-muted">Currently saved on the server:</p>

          <dl
            data-testid="conflict-current"
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-control bg-surface-muted p-3 text-sm"
          >
            <dt className="text-content-subtle">Company</dt>
            <dd className="text-content">{current.company}</dd>
            <dt className="text-content-subtle">Role</dt>
            <dd className="text-content">{current.role}</dd>
            <dt className="text-content-subtle">Status</dt>
            <dd className="text-content">{STATUS_CONFIG[current.status].label}</dd>
            <dt className="text-content-subtle">Last saved</dt>
            <dd className="text-content">{formatDateTime(current.updatedAt)}</dd>
            <dt className="text-content-subtle">Version</dt>
            <dd className="text-content">{current.version}</dd>
          </dl>
        </div>
      ) : (
        <p className="text-sm text-content-muted">
          The application could not be read back, so it may have been deleted. Reloading is the
          safer choice.
        </p>
      )}
    </Modal>
  );
}
