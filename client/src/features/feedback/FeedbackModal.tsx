import { useMutation } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { z } from 'zod';
import { getErrorMessage } from '@/api/errors';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX,
  sendFeedback,
  type FeedbackCategory,
} from '@/api/feedback';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextArea } from '@/components/ui/TextArea';
import { TextField } from '@/components/ui/TextField';
import { useSession } from '@/hooks/useSession';

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  general: 'General feedback',
  bug: 'Bug',
  suggestion: 'Suggestion',
};

const feedbackFormSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z.string().trim().min(1, 'Write a message first').max(FEEDBACK_MESSAGE_MAX),
  replyTo: z.union([z.literal(''), z.string().trim().email('Enter a valid email address')]),
});

type FeedbackFormValues = z.infer<typeof feedbackFormSchema>;

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Sends feedback straight to the maintainer's inbox. The reply address starts as
 * the account's email; clearing it sends the feedback with no way to answer.
 * Closing keeps the draft, since the component stays mounted in the sidebar.
 */
export function FeedbackModal({ isOpen, onClose }: FeedbackModalProps): JSX.Element {
  const { user } = useSession();
  const defaults: FeedbackFormValues = {
    category: 'general',
    message: '',
    replyTo: user?.email ?? '',
  };

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackFormSchema),
    defaultValues: defaults,
  });

  const send = useMutation({
    mutationFn: sendFeedback,
    onSuccess: () => {
      toast.success('Thanks — your feedback is on its way');
      reset(defaults);
      onClose();
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Your feedback could not be sent'));
    },
  });

  const message = watch('message');
  const onSubmit = handleSubmit((values) => send.mutate(values));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Send feedback"
      description="Tell me what's wrong, missing, or worth adding."
      footer={
        <>
          <p className="mr-auto self-center text-xs text-content-subtle">
            Goes straight to my inbox.
          </p>
          <Button
            type="submit"
            form="feedback-form"
            disabled={message.trim() === ''}
            isLoading={send.isPending}
            loadingLabel="Sending"
          >
            Send feedback
          </Button>
        </>
      }
    >
      <form id="feedback-form" onSubmit={onSubmit} noValidate className="space-y-5">
        <fieldset>
          <legend className="text-sm font-medium text-content">What&rsquo;s this about?</legend>
          <div className="mt-2 space-y-2">
            {FEEDBACK_CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-3 text-sm text-content">
                <input
                  type="radio"
                  value={category}
                  className="h-4 w-4 accent-primary"
                  {...register('category')}
                />
                {CATEGORY_LABELS[category]}
              </label>
            ))}
          </div>
        </fieldset>

        <TextArea
          label="Your message"
          rows={5}
          maxLength={FEEDBACK_MESSAGE_MAX}
          placeholder="What happened, what you expected instead, or what would make this better."
          hint={`${message.length.toLocaleString('en')} / ${FEEDBACK_MESSAGE_MAX.toLocaleString('en')}`}
          error={errors.message?.message}
          {...register('message')}
        />

        <TextField
          label="Your email (optional, if you'd like a reply)"
          type="email"
          placeholder="you@example.com"
          error={errors.replyTo?.message}
          {...register('replyTo')}
        />
      </form>
    </Modal>
  );
}
