import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { TextField } from '@/components/ui/TextField';
import {
  applicationFormSchema,
  toFormValues,
  toOptimisticPatch,
  toPayload,
  type ApplicationFormValues,
} from '@/features/applications/applicationFormSchema';
import { VersionConflictDialog } from '@/features/applications/VersionConflictDialog';
import {
  useCreateApplication,
  useUpdateApplication,
} from '@/features/applications/useApplicationMutations';
import { applyServerErrors } from '@/features/auth/serverErrors';
import {
  EMPLOYMENT_TYPE_LABELS,
  SOURCE_LABELS,
  STATUS_CONFIG,
  WORK_MODE_LABELS,
} from '@/lib/statusConfig';
import {
  APPLICATION_STATUSES,
  EMPLOYMENT_TYPES,
  PRIORITIES,
  SOURCES,
  WORK_MODES,
  type Application,
  type VersionConflict,
} from '@/types/application';

interface ApplicationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Absent for a create; present for an edit. */
  application?: Application;
  onSaved?: (application: Application) => void;
}

const SERVER_FIELDS = ['company', 'role', 'location', 'companyWebsite', 'jobUrl', 'notes'] as const;

function options<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

const STATUS_OPTIONS = APPLICATION_STATUSES.map((status) => ({
  value: status,
  label: STATUS_CONFIG[status].label,
}));
const PRIORITY_OPTIONS = PRIORITIES.map((priority) => ({ value: priority, label: priority }));

export function ApplicationFormModal({
  isOpen,
  onClose,
  application,
  onSaved,
}: ApplicationFormModalProps): JSX.Element {
  const isEdit = application !== undefined;
  const [conflict, setConflict] = useState<VersionConflict | null>(null);

  const create = useCreateApplication();
  const update = useUpdateApplication(setConflict);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ApplicationFormValues>({
    resolver: zodResolver(applicationFormSchema),
    defaultValues: toFormValues(application),
  });

  // Reopening for a different row must not show the previous row's values, but a
  // background refetch must not wipe what the user is typing. Keying the reset on
  // the row identity and the open state, and reading the row through a ref,
  // separates those two: a new object for the same row is not a reason to reset.
  const applicationRef = useRef(application);
  applicationRef.current = application;
  const formIdentity = `${application?.id ?? 'new'}:${String(isOpen)}`;

  useEffect(() => {
    if (!isOpen) return;
    reset(toFormValues(applicationRef.current));
  }, [formIdentity, isOpen, reset]);

  async function save(values: ApplicationFormValues, overwrite: boolean): Promise<void> {
    try {
      const payload = toPayload(values);

      if (isEdit) {
        const saved = await update.mutateAsync({
          id: application.id,
          // Dropping `version` is what "overwrite" means: the server stops
          // checking the read the user started from and takes the write.
          payload: overwrite ? payload : { ...payload, version: application.version },
          optimisticPatch: toOptimisticPatch(values),
        });
        onSaved?.(saved);
      } else {
        const saved = await create.mutateAsync(payload);
        onSaved?.(saved);
      }

      setConflict(null);
      onClose();
    } catch (error) {
      applyServerErrors(error, setError, SERVER_FIELDS, 'Could not save the application');
    }
  }

  const onSubmit = handleSubmit((values) => save(values, false));

  return (
    <>
      <Modal
        isOpen={isOpen && conflict === null}
        onClose={onClose}
        size="lg"
        title={isEdit ? 'Edit application' : 'New application'}
        description={isEdit ? undefined : 'Only company and role are required; the rest can wait.'}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="application-form"
              isLoading={isSubmitting}
              loadingLabel="Saving"
            >
              {isEdit ? 'Save changes' : 'Create application'}
            </Button>
          </>
        }
      >
        <form id="application-form" onSubmit={onSubmit} noValidate className="space-y-4">
          {errors.root && (
            <p
              role="alert"
              className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {errors.root.message}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Company" error={errors.company?.message} {...register('company')} />
            <TextField label="Role" error={errors.role?.message} {...register('role')} />
            <Select label="Status" options={STATUS_OPTIONS} {...register('status')} />
            <Select label="Priority" options={PRIORITY_OPTIONS} {...register('priority')} />
            <Select
              label="Employment type"
              options={options(EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS)}
              {...register('employmentType')}
            />
            <Select
              label="Work mode"
              placeholder="Not set"
              options={options(WORK_MODES, WORK_MODE_LABELS)}
              {...register('workMode')}
            />
            <Select
              label="Source"
              placeholder="Not set"
              options={options(SOURCES, SOURCE_LABELS)}
              {...register('source')}
            />
            <TextField
              label="Location"
              error={errors.location?.message}
              {...register('location')}
            />
            <TextField
              label="Applied date"
              type="date"
              error={errors.appliedDate?.message}
              {...register('appliedDate')}
            />
            <TextField
              label="Deadline"
              type="date"
              error={errors.deadline?.message}
              {...register('deadline')}
            />
            <TextField
              label="Company website"
              placeholder="https://"
              error={errors.companyWebsite?.message}
              {...register('companyWebsite')}
            />
            <TextField
              label="Job posting URL"
              placeholder="https://"
              error={errors.jobUrl?.message}
              {...register('jobUrl')}
            />
            <TextField
              label="Resume version"
              error={errors.resumeVersion?.message}
              {...register('resumeVersion')}
            />
            <TextField
              label="Tags"
              hint="Comma separated"
              error={errors.tagsText?.message}
              {...register('tagsText')}
            />
          </div>

          <TextArea
            label="Notes"
            rows={4}
            hint="Markdown is supported."
            error={errors.notes?.message}
            {...register('notes')}
          />
        </form>
      </Modal>

      <VersionConflictDialog
        conflict={conflict}
        isPending={update.isPending}
        onDismiss={() => {
          setConflict(null);
        }}
        onReload={() => {
          const current = conflict?.current;
          setConflict(null);
          if (current) reset(toFormValues(current));
        }}
        onOverwrite={() => {
          const values = getValues();
          setConflict(null);
          void save(values, true);
        }}
      />
    </>
  );
}
