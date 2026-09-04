import { useId, useState } from 'react';

/**
 * The FAQ, per SPEC section 12.
 *
 * A native `<button aria-expanded>` plus a plain hidden panel, rather than a
 * `<details>` element or a headless library: `<details>` animates inconsistently
 * across browsers and reads inconsistently to screen readers, and a library
 * would be a dependency on the one route whose bundle budget is tightest. One
 * panel is open at a time, and the whole thing is keyboard-operable because the
 * control is a real button.
 */

interface QuestionAndAnswer {
  question: string;
  answer: string;
}

const FAQ: QuestionAndAnswer[] = [
  {
    question: 'Is it really free?',
    answer:
      'Yes. There is no paid tier, no trial, and no card required. It is an open-source project, and you can read every line of it or run your own copy.',
  },
  {
    question: 'Do I have to sign up to look around?',
    answer:
      'No. "Try the demo" drops you straight into a shared account already full of realistic data, with no email address and no password. It resets every night, so treat it as a showroom rather than somewhere to keep anything.',
  },
  {
    question: 'What happens to my data?',
    answer:
      'It stays yours. It is never sold, shared, or used to train anything. You can export the lot as JSON from Settings at any moment, and deleting your account removes everything — including uploaded files — after a 30-day grace period in case you change your mind.',
  },
  {
    question: 'Will it email me constantly?',
    answer:
      'No. There is one morning digest when something is actually due, and an optional weekly summary you have to switch on yourself. Both carry a one-click unsubscribe. The only mail you cannot turn off is about your account: verifying your address, password changes, and closing the account.',
  },
  {
    question: 'Does it apply to jobs for me?',
    answer:
      'No, and it never will. It is a record of applications you make yourself. Nothing is ever sent to an employer on your behalf.',
  },
  {
    question: 'Can I use it for graduate roles rather than internships?',
    answer:
      'Nothing in it is internship-specific — it is a pipeline with deadlines and interviews. Plenty of people use it for graduate schemes and full-time roles.',
  },
];

export function FaqAccordion(): JSX.Element {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const baseId = useId();

  return (
    <section aria-labelledby="faq-heading" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h2
        id="faq-heading"
        className="text-center text-2xl font-semibold tracking-tight text-content sm:text-3xl"
      >
        Questions people ask
      </h2>

      <div className="mt-10 divide-y divide-border rounded-xl border border-border bg-surface">
        {FAQ.map((entry, index) => {
          const isOpen = openIndex === index;
          const panelId = `${baseId}-panel-${String(index)}`;
          const buttonId = `${baseId}-button-${String(index)}`;

          return (
            <div key={entry.question}>
              <h3>
                <button
                  type="button"
                  id={buttonId}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => {
                    setOpenIndex(isOpen ? null : index);
                  }}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium text-content transition-colors hover:bg-surface-muted"
                >
                  {entry.question}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className={`h-4 w-4 shrink-0 text-content-subtle transition-transform ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </h3>
              <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!isOpen}>
                <p className="px-5 pb-5 text-sm leading-relaxed text-content-muted">
                  {entry.answer}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
