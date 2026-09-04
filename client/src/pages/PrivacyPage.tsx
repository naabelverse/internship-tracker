import { LegalPage } from '@/pages/LegalPage';
import privacyMarkdown from '../../content/privacy.md?raw';

export default function PrivacyPage(): JSX.Element {
  return (
    <LegalPage
      title="Privacy Policy"
      description="Exactly what Internship Tracker stores about you, why, how long it keeps it, and how to export or delete it. Your data is never sold or shared."
      source={privacyMarkdown}
    />
  );
}
