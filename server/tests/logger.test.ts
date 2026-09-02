import { logger, redactSecrets } from '@/config/logger';

describe('logger', () => {
  describe('redactSecrets', () => {
    it('replaces sensitive values at the top level', () => {
      expect(redactSecrets({ email: 'a@example.com', password: 'hunter2' })).toEqual({
        email: 'a@example.com',
        password: '[REDACTED]',
      });
    });

    it('replaces sensitive values nested inside objects and arrays', () => {
      const input = {
        user: { name: 'Ada', refreshToken: 'rt_live_123' },
        sessions: [{ tokenHash: 'abc' }, { ip: '203.0.113.4' }],
      };

      expect(redactSecrets(input)).toEqual({
        user: { name: 'Ada', refreshToken: '[REDACTED]' },
        sessions: [{ tokenHash: '[REDACTED]' }, { ip: '203.0.113.4' }],
      });
    });

    it('matches keys case-insensitively', () => {
      expect(redactSecrets({ Authorization: 'Bearer abc', Cookie: 'sid=1' })).toEqual({
        Authorization: '[REDACTED]',
        Cookie: '[REDACTED]',
      });
    });

    it('returns primitives untouched', () => {
      expect(redactSecrets('plain')).toBe('plain');
      expect(redactSecrets(42)).toBe(42);
      expect(redactSecrets(null)).toBeNull();
    });
  });

  describe('winston pipeline', () => {
    // Regression: a format that rebuilt the info object dropped winston's symbol
    // keys, so colorize() threw on every warn/error and turned mapped API errors
    // into blank 500s.
    it.each(['error', 'warn', 'info', 'http', 'debug'] as const)(
      'logs at %s level with metadata without throwing',
      (level) => {
        expect(() => {
          logger[level]('probe message', {
            requestId: 'abc-123',
            password: 'must-not-appear',
            nested: { accessToken: 'must-not-appear' },
          });
        }).not.toThrow();
      },
    );

    it('logs an Error instance without throwing', () => {
      expect(() => {
        logger.error(new Error('boom'));
      }).not.toThrow();
    });
  });
});
