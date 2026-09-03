import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextField } from '@/components/ui/TextField';
import { detectTimezone, registerSchema, type RegisterValues } from '@/features/auth/authSchemas';
import { applyServerErrors } from '@/features/auth/serverErrors';
import { useRegister } from '@/features/auth/useAuthMutations';
import { paths } from '@/routes/paths';

const FIELDS = ['name', 'email', 'password'] as const;

export function RegisterForm(): JSX.Element {
  const registerAccount = useRegister(paths.dashboard);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', acceptTerms: false as unknown as true },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await registerAccount.mutateAsync({
        name: values.name,
        email: values.email,
        password: values.password,
        acceptTerms: true,
        timezone: detectTimezone(),
      });
    } catch (error) {
      applyServerErrors(error, setError, FIELDS, 'Could not create your account');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root && (
        <p
          role="alert"
          className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {errors.root.message}
        </p>
      )}

      <TextField
        label="Name"
        autoComplete="name"
        placeholder="Ada Lovelace"
        error={errors.name?.message}
        {...register('name')}
      />

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
        autoComplete="new-password"
        hint="At least 8 characters, with an uppercase letter, a lowercase letter and a number."
        error={errors.password?.message}
        {...register('password')}
      />

      <Checkbox
        label="I accept the Terms of Service and the Privacy Policy."
        error={errors.acceptTerms?.message}
        {...register('acceptTerms')}
      />

      <Button
        type="submit"
        className="w-full"
        isLoading={isSubmitting}
        loadingLabel="Creating account"
      >
        Create account
      </Button>
    </form>
  );
}
