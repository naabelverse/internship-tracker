import { Link } from 'react-router-dom';
import { AuthSplitLayout } from '@/features/auth/AuthSplitLayout';
import { LoginForm } from '@/features/auth/LoginForm';
import { paths } from '@/routes/paths';

export function LoginPage(): JSX.Element {
  return (
    <AuthSplitLayout
      title="Sign in"
      subtitle="Pick up where you left off."
      footer={
        <>
          New here?{' '}
          <Link to={paths.register} className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthSplitLayout>
  );
}
