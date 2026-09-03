import { Link } from 'react-router-dom';
import { AuthSplitLayout } from '@/features/auth/AuthSplitLayout';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { paths } from '@/routes/paths';

export function RegisterPage(): JSX.Element {
  return (
    <AuthSplitLayout
      title="Create your account"
      subtitle="Track every application in one place."
      footer={
        <>
          Already have an account?{' '}
          <Link to={paths.login} className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthSplitLayout>
  );
}
