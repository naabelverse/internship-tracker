import { readFileSync } from 'node:fs';
import path from 'node:path';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '@/App';
import { paths } from '@/routes/paths';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState } from '../utils/render';

/**
 * Terms and Privacy, per SPEC section 12.
 *
 * The content assertions are deliberately about *substance* rather than wording:
 * that the privacy policy names the specific things this application stores, and
 * that neither document is boilerplate somebody forgot to adapt. A test that only
 * checked the pages render would pass just as happily on lorem ipsum.
 */

const CONTENT_DIR = path.resolve(__dirname, '..', '..', 'content');
const privacySource = readFileSync(path.join(CONTENT_DIR, 'privacy.md'), 'utf8');
const termsSource = readFileSync(path.join(CONTENT_DIR, 'terms.md'), 'utf8');

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('the legal pages render from markdown in the repository', () => {
  it('renders the privacy policy', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.privacy });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' }),
    ).toBeInTheDocument();
  });

  it('renders the terms of service', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.terms });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Terms of Service' }),
    ).toBeInTheDocument();
  });

  it('reaches one from the footer of the other', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.terms });
    await screen.findByRole('heading', { level: 1, name: 'Terms of Service' });

    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      paths.privacy,
    );
  });
});

describe('the privacy policy describes what this application actually stores', () => {
  // Every one of these is a field the server really writes. A policy that did not
  // name them would be boilerplate, which SPEC section 12 rules out.
  it.each([
    ['the password hash, and that it is bcrypt', /bcrypt/i],
    ['the application records the user enters', /every application and its status history/i],
    ['uploaded files', /upload/i],
    ['the IP address kept against a session', /IP address/i],
    ['the user agent kept against a session', /user agent/i],
    ['the timezone, and why it is needed', /timezone/i],
    ['the terms acceptance timestamp', /terms acceptance/i],
  ])('names %s', (_label, pattern) => {
    expect(privacySource).toMatch(pattern);
  });

  it('states the retention period and the purge', () => {
    expect(privacySource).toMatch(/30 days/);
    expect(privacySource).toMatch(/purged|permanently removed/i);
  });

  it('states plainly that data is never sold or shared', () => {
    expect(privacySource).toMatch(/never sold/i);
  });

  it('explains how to export and how to delete', () => {
    expect(privacySource).toMatch(/Export all my data/i);
    expect(privacySource).toMatch(/Close my account|Delete my account/i);
  });

  it('leaves the contact address as a placeholder for the operator to fill in', () => {
    expect(privacySource).toContain('{{CONTACT_EMAIL}}');
    expect(termsSource).toContain('{{CONTACT_EMAIL}}');
  });

  it('is not boilerplate', () => {
    expect(privacySource).not.toMatch(/lorem ipsum/i);
    expect(termsSource).not.toMatch(/lorem ipsum/i);
    // Generic templates talk about cookies and third-party advertising; this app
    // sets one httpOnly session cookie and runs no ad network, and the policy has
    // to say so rather than inherit somebody else's paragraph.
    expect(privacySource).toMatch(/no tracking or advertising cookies/i);
  });

  it('describes the demo account honestly in the terms', () => {
    expect(termsSource).toMatch(/shared/i);
    expect(termsSource).toMatch(/resets every night/i);
  });
});
