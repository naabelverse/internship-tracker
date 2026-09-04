import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { useUpdateProfile } from '@/features/settings/useSettingsMutations';
import { useResendVerification } from '@/features/auth/useLifecycleMutations';
import { applyServerErrors } from '@/features/auth/serverErrors';
import type { User } from '@/types/user';

const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address')
    .email('Enter a valid email address')
    .max(254, 'Use at most 254 characters'),
});

type EmailValues = z.infer<typeof emailSchema>;

/**
 * Changing the address.
 *
 * The server parks a new address on `pendingEmail` and leaves `email` alone
 * until it is confirmed, so this section shows both rather than swapping the
 * displayed address the moment the form is saved. Silently showing the new
 * address would tell the user the change is done while their old address is
 * still the one that signs them in.
 */
export function EmailSection({ user }: { user: User }): JSX.Element {
  const update = useUpdateProfile();
  const resend = useResendVerification();

  const form = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: user.pendingEmail ?? user.email },
  });

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(
      { email: values.email },
      {
        onError: (error) => {
          applyServerErrors(error, form.setError, ['email'], 'Your email could not be changed.');
        },
      },
    );
  });

  return (
    <SettingsSection
      title="Email address"
      description="A new address has to be confirmed before it takes effect."
      onSubmit={onSubmit}
      footer={
        <Button type="submit" isLoading={update.isPending} loadingLabel="Saving">
          Change email
        </Button>
      }
    >
      <dl className="grid gap-1 text-sm">
        <dt className="text-content-subtle">Current address</dt>
        <dd className="text-content" data-testid="current-email">
          {user.email}
          {user.emailVerified ? '' : ' (unconfirmed)'}
        </dd>
      </dl>

      {user.pendingEmail && (
        <div
          role="status"
          data-testid="pending-email-notice"
          className="space-y-2 rounded-control border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-content"
        >
          <p>
            Verification sent to <span className="font-medium">{user.pendingEmail}</span>. Your
            current address stays active until you confirm it.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={resend.isPending}
            loadingLabel="Sending"
            onClick={() => {
              resend.mutate();
            }}
          >
            Resend confirmation
          </Button>
        </div>
      )}

      <TextField
        label="New email address"
        type="email"
        autoComplete="email"
        error={form.formState.errors.email?.message}
        {...form.register('email')}
      />
    </SettingsSection>
  );
}
