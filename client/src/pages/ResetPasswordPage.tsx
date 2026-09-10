import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/FormError';
import { PasswordField } from '@/components/ui/PasswordField';
import { AuthSplitLayout } from '@/features/auth/AuthSplitLayout';
import { resetPasswordSchema, type ResetPasswordValues } from '@/features/auth/authSchemas';
import { resetPassword } from '@/api/auth';
import { getApiError } from '@/api/errors';
import { paths } from '@/routes/paths';

const EMPTY: ResetPasswordValues = { password: '', confirmPassword: '' };

/** The three ways a token can be refused, each said in its own words. */
const TOKEN_MESSAGES: Record<string, string> = {
  TOKEN_EXPIRED:
    'That link has expired. Reset links last 30 minutes; ask for a new one and it will work.',
  INVALID_TOKEN:
    'That link is not valid. It may already have been used, or the address bar may have cut it short. Ask for a new one.',
};

export function ResetPasswordPage(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: EMPTY,
  });

  const askAgain = (
    <Link to={paths.forgotPassword} className="font-medium text-primary hover:underline">
      Ask for a new link
    </Link>
  );

  if (token === '') {
    return (
      <AuthSplitLayout title="That link is incomplete" subtitle="" footer={askAgain}>
        <p role="alert" className="text-sm text-content">
          This page needs the token from your reset email. Open the link from the email itself, or
          ask for a new one.
        </p>
      </AuthSplitLayout>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await resetPassword(token, values.password);

      toast.success('Password reset. Sign in with your new password.');
      void navigate(paths.login, { replace: true });
    } catch (error) {
      const apiError = getApiError(error);
      const known = apiError?.code ? TOKEN_MESSAGES[apiError.code] : undefined;

      form.setError('root', {
        message: known ?? apiError?.message ?? 'Your password could not be reset. Try again.',
      });
    }
  });

  return (
    <AuthSplitLayout
      title="Choose a new password"
      subtitle="Use at least 8 characters with an uppercase letter, a lowercase letter and a number."
      footer={askAgain}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={form.formState.errors.root?.message} />

        <PasswordField
          label="New password"
          autoComplete="new-password"
          autoFocus
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          error={form.formState.errors.confirmPassword?.message}
          {...form.register('confirmPassword')}
        />

        <Button type="submit" isLoading={form.formState.isSubmitting} loadingLabel="Resetting">
          Set new password
        </Button>
      </form>
    </AuthSplitLayout>
  );
}

/** Default export as well, so `React.lazy` can import this route. */
export default ResetPasswordPage;
