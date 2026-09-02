import os from 'node:os';
import path from 'node:path';

/**
 * Runs before every test file (jest `setupFiles`), so the zod env loader has a
 * valid configuration by the time any module under test imports it.
 */
process.env.NODE_ENV = 'test';
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/internship_tracker_test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-not-used-outside-jest-runs';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-not-used-outside-jest-runs';
process.env.LOG_LEVEL ??= 'error';

// Trust one proxy hop so tests can vary the client IP with X-Forwarded-For and
// exercise the IP-keyed and email-keyed rate limiters independently. This also
// matches how the API runs behind Render or Railway in production.
process.env.TRUST_PROXY ??= '1';

// Uploads land in a scratch directory, never the repository, and the scheduler
// stays off so tests drive the sweep directly instead of waiting for a tick.
process.env.UPLOAD_DIR ??= path.join(os.tmpdir(), 'internship-tracker-test-uploads');
process.env.ENABLE_CRON ??= 'false';
process.env.REMINDER_DIGEST_HOUR ??= '8';
