import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  isPending?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The confirm step SPEC section 6 requires before a destructive quick action. */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  isPending = false,
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            isLoading={isPending}
            loadingLabel="Working"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-content-muted">{message}</p>
    </Modal>
  );
}
