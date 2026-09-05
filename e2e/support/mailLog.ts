import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';

const run = promisify(execFile);

const COMPOSE_ARGS = [
  'compose',
  '-p',
  process.env.E2E_PROJECT ?? 'internship-tracker-e2e',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.e2e.yml',
];

/**
 * Reads the API container's log.
 *
 * SPEC section 10 says to take the verification token "from the console/mail
 * transport in test mode", and that is exactly what this does: the E2E stack
 * runs `MAIL_TRANSPORT=console`, which prints the rendered message body — links
 * included — through the logger. No test-only endpoint was added to the server
 * to make this easier; a route that hands out verification tokens would be a
 * real hole kept alive by a test.
 */
async function apiLog(): Promise<string> {
  const { stdout } = await run('docker', [...COMPOSE_ARGS, 'logs', '--no-log-prefix', 'api'], {
    maxBuffer: 64 * 1024 * 1024,
  });

  return stdout;
}

/**
 * The most recent single-use link the API mailed to `email`.
 *
 * Matched against the address as well as the path, because a run registers
 * several accounts and the log is append-only: the last link in the file is not
 * necessarily this account's. The log is scanned in reverse so a resend wins
 * over the original.
 */
export async function waitForMailLink(
  email: string,
  path: '/verify-email' | '/reset-password',
): Promise<string> {
  let link = '';

  await expect
    .poll(
      async () => {
        const log = await apiLog();
        link = findLink(log, email, path);
        return link;
      },
      {
        message: `No ${path} link for ${email} appeared in the API log`,
        timeout: 20_000,
        intervals: [500, 1_000, 2_000],
      },
    )
    .not.toBe('');

  return link;
}

/**
 * The console transport prints one block per message, headed by `to: <address>`.
 * Splitting on that header keeps each message's links with their own recipient,
 * so a link is never attributed to the account whose message happens to precede
 * it.
 */
function findLink(log: string, email: string, path: string): string {
  const blocks = log.split(/^\s*to:\s*/m);
  // `String.raw` because a plain template literal would eat the backslash in
  // `\s`, leaving a class that excludes the letter "s" and so never matches a
  // link beginning "https://localhost".
  const wanted = new RegExp(
    String.raw`https?://[^\s"'<>]*` + path + String.raw`[?]token=[^\s"'<>]+`,
  );

  for (let index = blocks.length - 1; index >= 1; index -= 1) {
    const block = blocks[index] ?? '';
    if (!block.toLowerCase().startsWith(email.toLowerCase())) continue;

    const match = wanted.exec(block);
    if (match) return match[0].replace(/&amp;/g, '&');
  }

  return '';
}
