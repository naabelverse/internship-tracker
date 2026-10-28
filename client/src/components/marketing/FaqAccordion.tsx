import { useId, useLayoutEffect, useRef, useState } from 'react';

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
      'It stays yours. It is never sold, shared, or used to train anything. You can export the lot as JSON from Settings at any moment. Closing your account starts a 30-day grace period: sign in with your email and password during it and you can restore everything as you left it. After 30 days the account and its data, including uploaded files, are permanently deleted. Password reset does not work for a closed account, so if you have forgotten your password, you will not be able to restore it yourself.',
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
      'Yes. Nothing in it is internship-specific: it is a pipeline with deadlines and interviews, so it works just as well for graduate schemes and full-time roles.',
  },
];

export function FaqAccordion(): JSX.Element {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const baseId = useId();
  const gridRef = useRef<HTMLDivElement>(null);

  /*
    Centres the heading against the list as it stands with every answer
    closed, so opening one grows the list downward without moving the
    heading. CSS alone centres against the live height, which shifts it on
    every toggle. The observer fires once before first paint, then again when
    a width change or a late font rewraps the text. Below `lg` the list sits
    under the heading rather than beside it, and the margin is zero.
  */
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // Source order, which the JSX below fixes: heading, list.
    const [head, list] = Array.from(grid.children) as HTMLElement[];

    const observer = new ResizeObserver(() => {
      const stacked = list.offsetTop >= head.offsetTop + head.offsetHeight;
      let room = list.offsetHeight - head.offsetHeight;
      list.querySelectorAll<HTMLElement>('[role="region"]').forEach((panel) => {
        room -= panel.offsetHeight;
      });
      head.style.marginTop = stacked ? '0px' : `${String(Math.max(0, room / 2))}px`;
    });
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <section aria-labelledby="faq-heading" className="border-t border-border bg-surface">
      {/*
        The heading sits beside the answers rather than centred above them, so
        the questions read as one continuous ruled column instead of a boxed
        widget in the middle of the page. The trailing `1fr` row takes whatever an
        open answer adds, so the heading's row stays the height of its own
        content. The list is `self-start` and the rows carry no gap, so the
        list's height is its own and never a product of the offset measured from
        it.
      */}
      <div
        ref={gridRef}
        className="marketing-shell grid gap-8 py-16 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-0"
      >
        <h2
          id="faq-heading"
          className="text-display-md stretch-wide text-content lg:col-span-4 lg:row-start-1"
        >
          Questions people ask
        </h2>

        <div className="divide-y divide-border border-t border-border lg:col-span-8 lg:col-start-5 lg:row-span-2 lg:row-start-1 lg:self-start">
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
                    className="flex w-full items-center gap-4 py-5 text-left text-base font-semibold tracking-tight text-content transition-colors hover:text-primary"
                  >
                    <span
                      aria-hidden="true"
                      className="w-7 shrink-0 text-sm stretch-display text-primary"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="flex-1">{entry.question}</span>
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
                  <p className="max-w-[68ch] pb-6 pl-11 text-sm leading-relaxed text-content-muted nums-proportional">
                    {entry.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
