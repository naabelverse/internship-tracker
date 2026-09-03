import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { TextField } from '@/components/ui/TextField';
import * as interviewsApi from '@/api/interviews';
import { getErrorMessage } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { commitCachedApplication } from '@/features/applications/optimisticCache';
import { INTERVIEW_MODE_LABELS, INTERVIEW_TYPE_LABELS } from '@/lib/statusConfig';
import { INTERVIEW_MODES, INTERVIEW_TYPES, type Application } from '@/types/application';

const interviewFormSchema = z.object({
  type: z.enum(INTERVIEW_TYPES),
  mode: z.enum(INTERVIEW_MODES),
  scheduledAt: z.string().min(1, 'Pick a date and time'),
  interviewer: z.string().trim().max(120).optional(),
  round: z.string().optional(),
  link: z.string().trim().optional(),
  prepNotes: z.string().max(5000).optional(),
});

type InterviewFormValues = z.infer<typeof interviewFormSchema>;

interface InterviewFormModalProps {
  isOpen: boolean;
  applicationId: string;
  onClose: () => void;
}

const TYPE_OPTIONS = INTERVIEW_TYPES.map((type) => ({
  value: type,
  label: INTERVIEW_TYPE_LABELS[type],
}));
const MODE_OPTIONS = INTERVIEW_MODES.map((mode) => ({
  value: mode,
  label: INTERVIEW_MODE_LABELS[mode],
}));

/** The "add interview" quick action from SPEC section 6's detail header. */
export function InterviewFormModal({
  isOpen,
  applicationId,
  onClose,
}: InterviewFormModalProps): JSX.Element {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InterviewFormValues>({
    resolver: zodResolver(interviewFormSchema),
    defaultValues: { type: 'technical', mode: 'video', scheduledAt: '' },
  });

  const create = useMutation({
    mutationFn: (payload: interviewsApi.InterviewPayload) =>
      interviewsApi.createInterview(applicationId, payload),
    onSuccess: (saved: Application) => {
      commitCachedApplication(queryClient, saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.lists() });
      toast.success('Interview added');
      reset();
      onClose();
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'The interview could not be added'));
    },
  });

  const onSubmit = handleSubmit((values) => {
    const round = Number(values.round);

    create.mutate({
      type: values.type,
      mode: values.mode,
      scheduledAt: new Date(values.scheduledAt).toISOString(),
      interviewer: values.interviewer === '' ? undefined : values.interviewer,
      round: Number.isInteger(round) && round > 0 ? round : undefined,
      link: values.link === '' ? undefined : values.link,
      prepNotes: values.prepNotes === '' ? undefined : values.prepNotes,
    });
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add an interview"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="interview-form"
            isLoading={isSubmitting || create.isPending}
            loadingLabel="Saving"
          >
            Add interview
          </Button>
        </>
      }
    >
      <form id="interview-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" options={TYPE_OPTIONS} {...register('type')} />
          <Select label="Mode" options={MODE_OPTIONS} {...register('mode')} />
          <TextField
            label="Scheduled at"
            type="datetime-local"
            error={errors.scheduledAt?.message}
            {...register('scheduledAt')}
          />
          <TextField label="Round" type="number" min={1} {...register('round')} />
          <TextField label="Interviewer" {...register('interviewer')} />
          <TextField label="Meeting link" placeholder="https://" {...register('link')} />
        </div>

        <TextArea label="Preparation notes" rows={3} {...register('prepNotes')} />
      </form>
    </Modal>
  );
}
