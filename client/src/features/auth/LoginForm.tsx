import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/FormError';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextField } from '@/components/ui/TextField';
import { loginSchema, type LoginValues } from '@/features/auth/authSchemas';
import { applyServerErrors } from '@/features/auth/serverErrors';
import { useLogin } from '@/features/auth/useAuthMutations';
import { readRedirectTarget } from '@/routes/redirectTarget';

const FIELDS = ['email', 'password'] as const;

export function LoginForm(): JSX.Element {
  const redirectTo = readRedirectTarget(useLocation().state);
  const login = useLogin(redirectTo);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
    } catch (error) {
      applyServerErrors(error, setError, FIELDS, 'Could not sign you in');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormError message={errors.root?.message} />

      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@university.edu"
        error={errors.email?.message}
        {...register('email')}
      />

      <PasswordField
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />

      <Button type="submit" className="w-full" isLoading={isSubmitting} loadingLabel="Signing in">
        Sign in
      </Button>
    </form>
  );
}
