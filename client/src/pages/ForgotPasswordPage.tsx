import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { AuthSplitLayout } from '@/features/auth/AuthSplitLayout';
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/features/auth/authSchemas';
import { forgotPassword } from '@/api/auth';
import { paths } from '@/routes/paths';

/**
 * Ask for a reset link.
 *
 * The server answers identically whether or not the address has an account, and
 * this page is careful not to give that guarantee away. There is no lookup, no
 * "we don't recognise that address", and no branch on the response: the
 * confirmation is rendered from the address that was typed, and it is rendered
 * even when the request fails, because a network error on a real account and a
 * network error on a fake one must not look different either.
 *
 * The cost is that a genuine outage is silent here. That is the deliberate
 * trade: the failure mode of a chatty version is telling an attacker which of a
 * million addresses are registered.
 */
export function ForgotPasswordPage(): JSX.Element {
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await forgotPassword(values.email);
    } catch {
      // Deliberately swallowed: see the note above.
    }

    setSentTo(values.email);
  });

  const backToSignIn = (
    <Link to={paths.login} className="font-medium text-primary hover:underline">
      Back to sign in
    </Link>
  );

  if (sentTo !== null) {
    return (
      <AuthSplitLayout title="Check your inbox" subtitle="" footer={backToSignIn}>
        <div className="space-y-3" data-testid="forgot-password-sent">
          <p role="status" className="text-sm text-content">
            If <span className="font-medium">{sentTo}</span> has an account, a reset link is on its
            way. It works once and expires in 30 minutes.
          </p>
          <p className="text-sm text-content-muted">
            Nothing arrived? Check the spam folder, then try again in a few minutes.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSentTo(null);
              form.reset({ email: '' });
            }}
          >
            Use a different address
          </Button>
        </div>
      </AuthSplitLayout>
    );
  }

  return (
    <AuthSplitLayout
      title="Reset your password"
      subtitle="We will email you a link to set a new one."
      footer={backToSignIn}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Button type="submit" isLoading={form.formState.isSubmitting} loadingLabel="Sending">
          Send reset link
        </Button>
      </form>
    </AuthSplitLayout>
  );
}

/** Default export as well, so `React.lazy` can import this route. */
export default ForgotPasswordPage;
