import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextField } from '@/components/ui/TextField';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { useDeleteAccount } from '@/features/auth/useLifecycleMutations';
import { applyServerErrors } from '@/features/auth/serverErrors';

/** Typed exactly, in capitals, so it cannot be produced by a stray keystroke. */
const CONFIRM_PHRASE = 'DELETE';

const deleteSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm'),
  confirmation: z.literal(CONFIRM_PHRASE, {
    errorMap: () => ({ message: `You must type ${CONFIRM_PHRASE} exactly, in capitals` }),
  }),
});

type DeleteValues = z.infer<typeof deleteSchema>;

/**
 * Closing the account.
 *
 * Three gates, on purpose, because this starts a 30 day clock on someone's real
 * data: the form is not even rendered until the user asks for it, then it needs
 * the account password and the word DELETE typed exactly. The password is
 * re-checked server-side regardless - the gates here are about intent, not
 * authorisation.
 *
 * The copy says what actually happens rather than what would be reassuring.
 * Signing in with the same password inside the 30 days offers a restore, but
 * forgot-password filters out closed accounts, so a forgotten password cannot
 * get one back. Uploaded files are named as the exception because the purge
 * does not yet erase them (issue #34).
 */
export function DangerZoneSection(): JSX.Element {
  const [isConfirming, setIsConfirming] = useState(false);
  const deleteAccount = useDeleteAccount();

  const form = useForm<DeleteValues>({
    resolver: zodResolver(deleteSchema),
    defaultValues: { password: '', confirmation: '' as DeleteValues['confirmation'] },
  });

  const onSubmit = form.handleSubmit((values) => {
    deleteAccount.mutate(values.password, {
      onError: (error) => {
        applyServerErrors(error, form.setError, ['password'], 'Your account could not be closed.');
      },
    });
  });

  return (
    <SettingsSection
      title="Close your account"
      description="This signs you out everywhere and starts a 30 day countdown to permanent deletion."
      onSubmit={isConfirming ? onSubmit : undefined}
      footer={
        isConfirming ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsConfirming(false);
                form.reset();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              isLoading={deleteAccount.isPending}
              loadingLabel="Closing"
            >
              Close my account permanently
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              setIsConfirming(true);
            }}
          >
            Close my account
          </Button>
        )
      }
    >
      <div className="space-y-2 text-sm text-content">
        <p>
          Your account and its records (applications, interviews, notes and reminders) are kept for
          30 days and then deleted for good, and your email address stays reserved for that window.
          Uploaded files are not yet removed with them: to make sure a file is gone, delete it from
          its application before you close the account.
        </p>
        <p className="text-content-muted">
          You can restore the account by signing in within those 30 days. Password reset does not
          work on a closed account, so if you forget your password you will not be able to restore
          it.
        </p>
      </div>

      {isConfirming && (
        <div className="space-y-4 rounded-control border border-danger/40 bg-danger/5 p-3">
          <PasswordField
            label="Your password"
            autoComplete="current-password"
            autoFocus
            error={form.formState.errors.password?.message}
            {...form.register('password')}
          />
          <TextField
            label={`Type ${CONFIRM_PHRASE} to confirm`}
            autoComplete="off"
            error={form.formState.errors.confirmation?.message}
            {...form.register('confirmation')}
          />
        </div>
      )}
    </SettingsSection>
  );
}
