import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Select';
import { ArchiveIcon, TrashIcon } from '@/components/ui/icons';
import { STATUS_CONFIG } from '@/lib/statusConfig';
import { APPLICATION_STATUSES, type ApplicationStatus } from '@/types/application';

interface BulkActionsBarProps {
  selectedIds: string[];
  isPending: boolean;
  onClear: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onSetStatus: (status: ApplicationStatus) => void;
}

const STATUS_OPTIONS = APPLICATION_STATUSES.map((status) => ({
  value: status,
  label: STATUS_CONFIG[status].label,
}));

/** Appears only when rows are selected, as SPEC section 6 describes. */
export function BulkActionsBar({
  selectedIds,
  isPending,
  onClear,
  onArchive,
  onUnarchive,
  onDelete,
  onSetStatus,
}: BulkActionsBarProps): JSX.Element | null {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (selectedIds.length === 0) return null;

  const count = selectedIds.length;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-card border border-primary/40 bg-primary/5 px-4 py-3"
    >
      <p className="mr-auto text-sm font-medium text-content">{count} selected</p>

      <div className="w-44">
        <Select
          label="Set status for selected"
          labelHidden
          options={STATUS_OPTIONS}
          placeholder="Set status…"
          value=""
          disabled={isPending}
          onChange={(event) => {
            const next = event.target.value;
            if (next) onSetStatus(next as ApplicationStatus);
          }}
          className="h-9"
        />
      </div>

      <Button variant="secondary" size="sm" onClick={onArchive} disabled={isPending}>
        <ArchiveIcon className="h-4 w-4" />
        Archive
      </Button>
      <Button variant="secondary" size="sm" onClick={onUnarchive} disabled={isPending}>
        Unarchive
      </Button>
      <Button
        variant="danger"
        size="sm"
        onClick={() => {
          setConfirmingDelete(true);
        }}
        disabled={isPending}
      >
        <TrashIcon className="h-4 w-4" />
        Delete
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>

      <ConfirmDialog
        isOpen={confirmingDelete}
        title={`Delete ${String(count)} applications?`}
        message="This cannot be undone. Their interviews, notes and attachments go with them."
        confirmLabel="Delete them"
        isPending={isPending}
        onCancel={() => {
          setConfirmingDelete(false);
        }}
        onConfirm={() => {
          setConfirmingDelete(false);
          onDelete();
        }}
      />
    </div>
  );
}
