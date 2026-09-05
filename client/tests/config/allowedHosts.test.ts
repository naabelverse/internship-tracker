import { describe, expect, it } from 'vitest';
import { buildAllowedHosts } from '../../allowedHosts';

/**
 * Vite 6's matcher, reimplemented from `isHostAllowedWithoutCache` so these cases
 * assert the decision the real server reaches rather than the shape of a list.
 *
 * The unconditional allowances at the top are Vite's, not ours, and they are why
 * `localhost` is absent from the configured list: local development never
 * consults it.
 */
function viteWouldAllow(allowedHosts: string[], hostHeader: string): boolean {
  const trimmed = hostHeader.trim();

  if (trimmed.startsWith('[')) return trimmed.includes(']');

  const colon = trimmed.indexOf(':');
  const hostname = colon === -1 ? trimmed : trimmed.slice(0, colon);

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;

  return allowedHosts.some(
    (allowed) =>
      allowed === hostname ||
      (allowed.startsWith('.') && (allowed.slice(1) === hostname || hostname.endsWith(allowed))),
  );
}

describe('the deployed host is allowed', () => {
  it('accepts the Railway-assigned domain that was being blocked', () => {
    const hosts = buildAllowedHosts({});

    expect(viteWouldAllow(hosts, 'internship-tracker-by-naabel.up.railway.app')).toBe(true);
  });

  it('accepts any other Railway subdomain, so a reassignment does not break it', () => {
    const hosts = buildAllowedHosts({});

    expect(viteWouldAllow(hosts, 'some-other-name.up.railway.app')).toBe(true);
    expect(viteWouldAllow(hosts, 'up.railway.app')).toBe(true);
  });

  it('accepts a custom domain taken from VITE_APP_URL, with no other configuration', () => {
    const hosts = buildAllowedHosts({ VITE_APP_URL: 'https://tracker.example.com' });

    expect(viteWouldAllow(hosts, 'tracker.example.com')).toBe(true);
  });

  it('ignores the port and path in VITE_APP_URL, because Vite matches on hostname', () => {
    const hosts = buildAllowedHosts({ VITE_APP_URL: 'https://tracker.example.com:8443/app' });

    expect(hosts).toContain('tracker.example.com');
    expect(viteWouldAllow(hosts, 'tracker.example.com:8443')).toBe(true);
  });

  it('accepts extra hosts from ALLOWED_HOSTS', () => {
    const hosts = buildAllowedHosts({ ALLOWED_HOSTS: 'staging.example.com, old.example.com' });

    expect(viteWouldAllow(hosts, 'staging.example.com')).toBe(true);
    expect(viteWouldAllow(hosts, 'old.example.com')).toBe(true);
  });

  it('survives an unparseable VITE_APP_URL rather than throwing at config load', () => {
    expect(() => buildAllowedHosts({ VITE_APP_URL: 'not a url' })).not.toThrow();
    expect(buildAllowedHosts({ VITE_APP_URL: 'not a url' })).toEqual(['.up.railway.app']);
  });
});

/**
 * The half that matters. A "fix" that let every host through would satisfy every
 * case above while destroying the protection, so each of these pins a host that
 * must still be turned away.
 */
describe('the check still rejects everything else', () => {
  const hosts = buildAllowedHosts({ VITE_APP_URL: 'https://tracker.example.com' });

  it('rejects an unrelated domain', () => {
    expect(viteWouldAllow(hosts, 'evil.example.org')).toBe(false);
  });

  it('rejects a lookalike that merely contains the allowed host', () => {
    expect(viteWouldAllow(hosts, 'tracker.example.com.evil.org')).toBe(false);
  });

  it('rejects a suffix match that is not on a dot boundary', () => {
    expect(viteWouldAllow(hosts, 'nottracker.example.com')).toBe(false);
    expect(viteWouldAllow(hosts, 'evilup.railway.app')).toBe(false);
  });

  it('rejects a platform subdomain outside the configured suffix', () => {
    expect(viteWouldAllow(hosts, 'anything.onrender.com')).toBe(false);
    expect(viteWouldAllow(hosts, 'anything.railway.app')).toBe(false);
  });

  it('rejects an empty Host header', () => {
    expect(viteWouldAllow(hosts, '')).toBe(false);
  });

  it('does not become permissive when nothing is configured', () => {
    const bare = buildAllowedHosts({});

    expect(bare).toEqual(['.up.railway.app']);
    expect(viteWouldAllow(bare, 'evil.example.org')).toBe(false);
  });
});

describe('local development does not depend on this list', () => {
  const hosts = buildAllowedHosts({});

  it.each(['localhost:5173', 'localhost:4173', '127.0.0.1:5173', 'app.localhost'])(
    'allows %s unconditionally, through Vite itself',
    (host) => {
      expect(viteWouldAllow(hosts, host)).toBe(true);
    },
  );
});
