import { readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_PRODUCT_NAME } from '@/config/app-info';
import type { MailFooter } from '@/mail/layout';
import { MAIL_LINK_PATHS } from '@/mail/links';
import { renderMail } from '@/mail/templates';
import { MAIL_CATEGORY, MAIL_KINDS, type MailKind, type MailMessage } from '@/mail/types';

/**
 * Every template, rendered. The suite is shaped around the properties SPEC
 * section 13 actually asks for: both bodies exist and agree, the shared layout
 * is present on all six, and the unsubscribe link appears on exactly the
 * non-transactional pair.
 */

const PREFERENCES_URL = 'http://localhost:5173/settings';
const UNSUBSCRIBE_URL = 'http://localhost:5000/api/v1/email/unsubscribe?token=abc';

const securityFooter: MailFooter = { preferencesUrl: PREFERENCES_URL };
const optionalFooter: MailFooter = {
  preferencesUrl: PREFERENCES_URL,
  unsubscribeUrl: UNSUBSCRIBE_URL,
  unsubscribeLabel: 'reminder emails',
};

/** One representative message per kind, with the data a real send would carry. */
const MESSAGES: Record<MailKind, MailMessage> = {
  verify_email: {
    kind: 'verify_email',
    data: {
      name: 'Ada',
      verifyUrl: 'http://localhost:5173/verify-email?token=tok',
      expiresInHours: 24,
      isNewAccount: true,
    },
  },
  password_reset: {
    kind: 'password_reset',
    data: {
      name: 'Ada',
      resetUrl: 'http://localhost:5173/reset-password?token=tok',
      expiresInMinutes: 30,
    },
  },
  password_changed: { kind: 'password_changed', data: { name: 'Ada', via: 'settings' } },
  account_deleted: { kind: 'account_deleted', data: { name: 'Ada', purgeDays: 30 } },
  reminder_digest: {
    kind: 'reminder_digest',
    data: {
      name: 'Ada',
      items: [
        {
          title: 'Application deadline',
          dueLabel: 'Fri 11 Sep, 09:00',
          context: 'Stripe — Backend Intern',
        },
        { title: 'Technical interview', dueLabel: 'Fri 11 Sep, 14:30' },
      ],
    },
  },
  weekly_summary: {
    kind: 'weekly_summary',
    data: {
      name: 'Ada',
      weekLabel: '31 Aug – 6 Sep',
      stats: {
        created: 7,
        applied: 5,
        responded: 2,
        interviewed: 1,
        offers: 0,
        responseRate: 40,
        currentStreakDays: 4,
        weeklyGoalTarget: 5,
        weeklyGoalCompleted: 5,
      },
      upcoming: [{ title: 'Deadline', dueLabel: 'Mon 8 Sep, 09:00' }],
    },
  },
};

function render(kind: MailKind) {
  const footer = MAIL_CATEGORY[kind] === 'security' ? securityFooter : optionalFooter;

  return renderMail(MESSAGES[kind], footer);
}

describe('every template renders both bodies through the shared layout', () => {
  it.each(MAIL_KINDS)('%s has a subject, HTML and plain text', (kind) => {
    const mail = render(kind);

    expect(mail.subject.length).toBeGreaterThan(0);
    expect(mail.text.trim().length).toBeGreaterThan(0);
    expect(mail.html).toContain('<!doctype html>');
  });

  it.each(MAIL_KINDS)('%s carries the app name and logo mark in both bodies', (kind) => {
    const mail = render(kind);

    expect(mail.html).toContain(APP_PRODUCT_NAME);
    expect(mail.text).toContain(APP_PRODUCT_NAME);
  });

  it.each(MAIL_KINDS)('%s is responsive rather than a fixed width page', (kind) => {
    const { html } = render(kind);

    expect(html).toContain('max-width:600px');
    expect(html).toContain('@media only screen and (max-width:600px)');
    expect(html).toContain('name="viewport"');
  });

  it.each(MAIL_KINDS)('%s greets the recipient in both bodies', (kind) => {
    const mail = render(kind);

    expect(mail.html).toContain('Hi Ada,');
    expect(mail.text).toContain('Hi Ada,');
  });
});

describe('the plain text alternative is a projection of the same blocks', () => {
  it('carries every link the HTML does, so a text-only reader is never stuck', () => {
    const mail = render('verify_email');

    expect(mail.html).toContain('http://localhost:5173/verify-email?token=tok');
    expect(mail.text).toContain('http://localhost:5173/verify-email?token=tok');
  });

  it('lists every digest item, with its due label, in both bodies', () => {
    const mail = render('reminder_digest');

    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('Application deadline');
      expect(body).toContain('Fri 11 Sep, 09:00');
      expect(body).toContain('Technical interview');
    }
  });

  it('carries every weekly figure in both bodies', () => {
    const mail = render('weekly_summary');

    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('31 Aug – 6 Sep');
      expect(body).toContain('Applied');
      expect(body).toContain('Interviews');
    }
  });

  it('escapes markup in supplied content rather than embedding it', () => {
    const mail = renderMail(
      {
        kind: 'reminder_digest',
        data: {
          name: '<script>alert(1)</script>',
          items: [{ title: 'Deadline & review', dueLabel: 'Fri 11 Sep, 09:00' }],
        },
      },
      optionalFooter,
    );

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('Deadline &amp; review');
    // The text body is not markup, so it carries the raw characters.
    expect(mail.text).toContain('Deadline & review');
  });
});

describe('unsubscribe links appear on exactly the non-transactional mail', () => {
  const optionalKinds = MAIL_KINDS.filter((kind) => MAIL_CATEGORY[kind] === 'optional');
  const securityKinds = MAIL_KINDS.filter((kind) => MAIL_CATEGORY[kind] === 'security');

  it('covers both categories, so neither list is silently empty', () => {
    expect(optionalKinds).toEqual(['reminder_digest', 'weekly_summary']);
    expect(securityKinds).toEqual([
      'verify_email',
      'password_reset',
      'password_changed',
      'account_deleted',
    ]);
  });

  it.each(optionalKinds)('%s offers an unsubscribe link in both bodies', (kind) => {
    const mail = render(kind);

    expect(mail.html).toContain(UNSUBSCRIBE_URL);
    expect(mail.text).toContain(UNSUBSCRIBE_URL);
  });

  it.each(securityKinds)('%s offers no unsubscribe link at all', (kind) => {
    const mail = render(kind);

    expect(mail.html).not.toContain('Unsubscribe');
    expect(mail.text).not.toContain('Unsubscribe');
  });

  it.each(MAIL_KINDS)('%s still links to the preferences page', (kind) => {
    const mail = render(kind);

    expect(mail.html).toContain(PREFERENCES_URL);
    expect(mail.text).toContain(PREFERENCES_URL);
  });
});

describe('email links point at routes the client actually serves', () => {
  it('mirrors the client path table', () => {
    // The workspaces share no code, so the server keeps its own copy of the
    // three paths email links at. Reading the client file rather than importing
    // it keeps the server build inside its own rootDir; this is what stops a
    // client route rename turning every button in every email into a 404.
    const source = readFileSync(
      path.resolve(__dirname, '..', '..', 'client', 'src', 'routes', 'paths.ts'),
      'utf8',
    );

    expect(source).toContain(`dashboard: '${MAIL_LINK_PATHS.dashboard}'`);
    expect(source).toContain(`board: '${MAIL_LINK_PATHS.board}'`);
    expect(source).toContain(`settings: '${MAIL_LINK_PATHS.settings}'`);
  });
});

describe('a rendered email, printed', () => {
  // SPEC section 16 phase 12: "Verify by printing a rendered email in the test
  // output." Both bodies go out, because both are what shipped.
  it('prints the welcome and verification email in full', () => {
    const mail = render('verify_email');

    process.stdout.write(
      [
        '',
        '='.repeat(72),
        'RENDERED EMAIL — verify_email',
        '='.repeat(72),
        `Subject: ${mail.subject}`,
        '',
        '--- text/plain -------------------------------------------------------',
        mail.text,
        '--- text/html --------------------------------------------------------',
        mail.html,
        '='.repeat(72),
        '',
      ].join('\n'),
    );

    expect(mail.subject).toContain(APP_PRODUCT_NAME);
  });
});
