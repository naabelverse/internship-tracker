import request from 'supertest';
import { FEEDBACK_INBOX } from '@/config/app-info';
import { clearMailQueue, mailQueueIdle, queuedMail, resetMailer } from '@/services/mailer.service';
import { buildTestApp, registerUser, useCleanAuthRateLimits } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();
const FEEDBACK = '/api/v1/email/feedback';

beforeEach(() => {
  resetMailer();
  clearMailQueue();
});

async function post(body: Record<string, unknown>, token?: string) {
  const req = request(app).post(FEEDBACK);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(body);
}

describe('POST /email/feedback', () => {
  it('mails the inbox with the sender named and the reply address as Reply-To', async () => {
    const { accessToken, payload } = await registerUser(app);

    const res = await post(
      { category: 'bug', message: 'The board froze.', replyTo: 'reply@example.com' },
      accessToken,
    );
    await mailQueueIdle();

    expect(res.status).toBe(202);
    const mail = queuedMail().find((m) => m.kind === 'feedback');
    expect(mail?.to).toBe(FEEDBACK_INBOX);
    expect(mail?.replyTo).toBe('reply@example.com');
    expect(mail?.subject).toBe(`[Bug report] from ${payload.name}`);
    expect(mail?.text).toContain('The board froze.');
    expect(mail?.text).toContain(payload.email.toLowerCase());
  });

  it('sets no Reply-To when the sender cleared the field', async () => {
    const { accessToken } = await registerUser(app);

    const res = await post({ category: 'general', message: 'Nice app.', replyTo: '' }, accessToken);
    await mailQueueIdle();

    expect(res.status).toBe(202);
    expect(queuedMail().find((m) => m.kind === 'feedback')?.replyTo).toBeUndefined();
  });

  it.each([
    ['an empty message', { category: 'bug', message: '   ' }],
    ['an unknown category', { category: 'praise', message: 'Hi' }],
    ['a message over 5,000 characters', { category: 'bug', message: 'x'.repeat(5001) }],
    ['a malformed reply address', { category: 'bug', message: 'Hi', replyTo: 'nope' }],
  ])('rejects %s', async (_label, body) => {
    const { accessToken } = await registerUser(app);

    const res = await post(body, accessToken);

    expect(res.status).toBe(400);
    expect(queuedMail().some((m) => m.kind === 'feedback')).toBe(false);
  });

  it('needs a session', async () => {
    const res = await post({ category: 'bug', message: 'Hi' });

    expect(res.status).toBe(401);
  });
});
