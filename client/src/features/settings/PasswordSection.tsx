import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/PasswordField';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { passwordSchema, type PasswordValues } from '@/features/settings/settingsSchemas';
import { useChangePassword } from '@/features/settings/useSettingsMutations';
import { applyServerErrors } from '@/features/auth/serverErrors';

const SERVER_FIELDS = ['currentPassword', 'newPassword'] as const;

const EMPTY: PasswordValues = { currentPassword: '', newPassword: '', confirmPassword: '' };

/**
 * Change password.
 *
 * SPEC section 5 has the server revoke every other refresh token on success, so
 * the consequence is spelled out before the button is pressed and repeated in
 * the success toast. Silently signing someone out of their phone while they sit
 * on their laptop is the kind of thing that arrives as a support complaint.
 */
export function PasswordSection(): JSX.Element {
  const changePassword = useChangePassword();
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: EMPTY,
  });

  const onSubmit = form.handleSubmit((values) => {
    changePassword.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      {
        onSuccess: () => {
          form.reset(EMPTY);
        },
        onError: (error) => {
          applyServerErrors(
            error,
            form.setError,
            SERVER_FIELDS,
            'Your password could not be changed.',
          );
        },
      },
    );
  });

  return (
    <SettingsSection
      title="Password"
      description="Use at least 8 characters with an uppercase letter, a lowercase letter and a number."
      onSubmit={onSubmit}
      footer={
        <Button type="submit" isLoading={changePassword.isPending} loadingLabel="Changing">
          Change password
        </Button>
      }
    >
      <p
        role="note"
        className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-content"
      >
        You will stay signed in on this device. Every other device is signed out and will have to
        sign in again with the new password.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <PasswordField
            label="Current password"
            autoComplete="current-password"
            error={form.formState.errors.currentPassword?.message}
            {...form.register('currentPassword')}
          />
        </div>
        <PasswordField
          label="New password"
          autoComplete="new-password"
          error={form.formState.errors.newPassword?.message}
          {...form.register('newPassword')}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          error={form.formState.errors.confirmPassword?.message}
          {...form.register('confirmPassword')}
        />
      </div>

      {form.formState.errors.root && (
        <p role="alert" className="text-sm text-danger">
          {form.formState.errors.root.message}
        </p>
      )}
    </SettingsSection>
  );
}
