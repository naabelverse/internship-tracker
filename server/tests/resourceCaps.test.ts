import request from 'supertest';
import type { Express } from 'express';
import {
  MAX_APPLICATIONS_PER_ACCOUNT,
  MAX_ATTACHMENTS_PER_APPLICATION,
  MAX_TOTAL_UPLOAD_BYTES,
} from '@/config/limits';
import { Application } from '@/models/Application';
import {
  APPLICATIONS_BASE,
  buildTestApp,
  createApplicationFor,
  registerUser,
  useCleanAuthRateLimits,
  type RegisteredUser,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

let app: Express;

beforeAll(() => {
  app = buildTestApp();
});

/**
 * Inserts rows straight through the model rather than through the API.
 *
 * Two thousand HTTP round trips would take minutes and prove nothing extra: the
 * cap is read off a `countDocuments`, so what matters is that the rows exist and
 * belong to this user. The 2001st still goes through the real endpoint, which is
 * the assertion that counts.
 */
async function fillApplications(user: RegisteredUser, count: number): Promise<void> {
  const now = new Date();

  await Application.insertMany(
    Array.from({ length: count }, (_, index) => ({
      user: user.userId,
      company: `Company ${String(index)}`,
      role: 'Software Engineering Intern',
      status: 'saved',
      statusHistory: [{ from: null, to: 'saved', changedAt: now }],
    })),
  );
}

/**
 * A PDF of an exact size.
 *
 * PDFs are stored byte for byte, unlike images, which `stripImageMetadata`
 * re-encodes - a padded PNG comes back out a few dozen bytes long, which would
 * make a byte-budget assertion prove nothing.
 */
function pdfOfSize(bytes: number): Buffer {
  const header = Buffer.from('%PDF-1.4 ');

  return Buffer.concat([header, Buffer.alloc(bytes - header.length, 0x20)]);
}

describe('per-account application cap', () => {
  it('rejects the 2001st application and leaves the existing 2000 untouched', async () => {
    const user = await registerUser(app);

    await fillApplications(user, MAX_APPLICATIONS_PER_ACCOUNT);
    expect(await Application.countDocuments({ user: user.userId })).toBe(
      MAX_APPLICATIONS_PER_ACCOUNT,
    );

    const response = await request(app)
      .post(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ company: 'One Too Many', role: 'Intern' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('APPLICATION_LIMIT_REACHED');
    // The message has to name the number, or the user cannot tell what to do.
    expect(response.body.message).toContain(String(MAX_APPLICATIONS_PER_ACCOUNT));

    // Nothing was written, and nothing already there was disturbed.
    expect(await Application.countDocuments({ user: user.userId })).toBe(
      MAX_APPLICATIONS_PER_ACCOUNT,
    );
    expect(await Application.countDocuments({ user: user.userId, company: 'One Too Many' })).toBe(
      0,
    );

    const list = await request(app)
      .get(`${APPLICATIONS_BASE}?limit=1`)
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(MAX_APPLICATIONS_PER_ACCOUNT);
  }, 120_000);

  it('accepts the 2000th, so the cap is a ceiling and not an off-by-one', async () => {
    const user = await registerUser(app);

    await fillApplications(user, MAX_APPLICATIONS_PER_ACCOUNT - 1);

    const response = await request(app)
      .post(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ company: 'Exactly At The Limit', role: 'Intern' });

    expect(response.status).toBe(201);
    expect(await Application.countDocuments({ user: user.userId })).toBe(
      MAX_APPLICATIONS_PER_ACCOUNT,
    );
  }, 120_000);

  it('is scoped per account: a full account does not block a different one', async () => {
    const full = await registerUser(app);
    const other = await registerUser(app);

    await fillApplications(full, MAX_APPLICATIONS_PER_ACCOUNT);

    const response = await request(app)
      .post(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ company: 'Room To Spare', role: 'Intern' });

    expect(response.status).toBe(201);
  }, 120_000);

  it('refuses a CSV import as a whole rather than filling the last few slots', async () => {
    const user = await registerUser(app);

    await fillApplications(user, MAX_APPLICATIONS_PER_ACCOUNT - 2);

    const csv = ['company,role', 'A,Intern', 'B,Intern', 'C,Intern', 'D,Intern'].join('\n');

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/import`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'applications.csv');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('APPLICATION_LIMIT_REACHED');
    // Not one row of the four was written.
    expect(await Application.countDocuments({ user: user.userId })).toBe(
      MAX_APPLICATIONS_PER_ACCOUNT - 2,
    );
  }, 120_000);
});

describe('upload caps', () => {
  it('rejects the 21st attachment on one application and keeps the 20 already there', async () => {
    const user = await registerUser(app);
    const created = await createApplicationFor(app, user.accessToken);

    // Written through the model for the same reason as above: 20 real uploads
    // would only re-prove the upload path, which the 21st exercises anyway.
    await Application.updateOne(
      { _id: created.id },
      {
        $set: {
          attachments: Array.from({ length: MAX_ATTACHMENTS_PER_APPLICATION }, (_, index) => ({
            filename: `attachments/${user.userId}/${created.id}/file-${String(index)}.pdf`,
            originalName: `cv-${String(index)}.pdf`,
            mimeType: 'application/pdf',
            size: 1_024,
            url: `/api/v1/applications/${created.id}/attachments`,
            uploadedAt: new Date(),
          })),
        },
      },
    );

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/${created.id}/attachments`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .attach('file', Buffer.from('%PDF-1.4 one too many'), {
        filename: 'extra.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ATTACHMENT_LIMIT_REACHED');
    expect(response.body.message).toContain(String(MAX_ATTACHMENTS_PER_APPLICATION));

    const after = await Application.findById(created.id);
    expect(after?.attachments).toHaveLength(MAX_ATTACHMENTS_PER_APPLICATION);
    // The originals are the originals: nothing was replaced or renamed.
    expect(after?.attachments[0].originalName).toBe('cv-0.pdf');
  });

  it('rejects a file that would cross the 100 MB account allowance', async () => {
    const user = await registerUser(app);
    const filled = await createApplicationFor(app, user.accessToken);
    const target = await createApplicationFor(app, user.accessToken);

    // One record accounting for the whole allowance bar a few kilobytes.
    await Application.updateOne(
      { _id: filled.id },
      {
        $set: {
          attachments: [
            {
              filename: `attachments/${user.userId}/${filled.id}/big.pdf`,
              originalName: 'archive.pdf',
              mimeType: 'application/pdf',
              size: MAX_TOTAL_UPLOAD_BYTES - 4_096,
              url: `/api/v1/applications/${filled.id}/attachments`,
              uploadedAt: new Date(),
            },
          ],
        },
      },
    );

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/${target.id}/attachments`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      // 8 KB against the 4 KB of headroom left above.
      .attach('file', pdfOfSize(8 * 1024), {
        filename: 'portfolio.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('STORAGE_LIMIT_REACHED');
    expect(response.body.message).toContain('100 MB');

    // The upload never reached the application it was aimed at.
    const after = await Application.findById(target.id);
    expect(after?.attachments).toHaveLength(0);
  });

  it('charges the stored size, so a re-encoded image is not billed at upload size', async () => {
    const user = await registerUser(app);
    const created = await createApplicationFor(app, user.accessToken);

    // A one-pixel PNG padded out to 64 KB. sharp re-encodes it on the way in and
    // the trailing padding is dropped, so the account is charged for the tens of
    // bytes that were actually written, not the 64 KB that were posted.
    const padded = Buffer.concat([
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
      Buffer.alloc(64 * 1024),
    ]);

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/${created.id}/attachments`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .attach('file', padded, { filename: 'pixel.png', contentType: 'image/png' });

    expect(response.status).toBe(201);

    const stored = await Application.findById(created.id);
    expect(stored?.attachments[0].size).toBeLessThan(padded.length);
    expect(stored?.attachments[0].size).toBeGreaterThan(0);
  });

  it('allows an upload that fits inside the remaining allowance', async () => {
    const user = await registerUser(app);
    const created = await createApplicationFor(app, user.accessToken);

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/${created.id}/attachments`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .attach('file', Buffer.from('%PDF-1.4 a normal cv'), {
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.application.attachments).toHaveLength(1);
  });
});

describe('GET /auth/me/usage', () => {
  it('reports what the account is using against each ceiling', async () => {
    const user = await registerUser(app);
    await createApplicationFor(app, user.accessToken);
    await createApplicationFor(app, user.accessToken);

    const response = await request(app)
      .get('/api/v1/auth/me/usage')
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.applications).toEqual({
      used: 2,
      limit: MAX_APPLICATIONS_PER_ACCOUNT,
      remaining: MAX_APPLICATIONS_PER_ACCOUNT - 2,
    });
    expect(response.body.data.storageBytes).toEqual({
      used: 0,
      limit: MAX_TOTAL_UPLOAD_BYTES,
      remaining: MAX_TOTAL_UPLOAD_BYTES,
    });
    expect(response.body.data.attachmentsPerApplication.limit).toBe(
      MAX_ATTACHMENTS_PER_APPLICATION,
    );
  });

  it('counts stored bytes after an upload, not the size that was posted', async () => {
    const user = await registerUser(app);
    const created = await createApplicationFor(app, user.accessToken);

    await request(app)
      .post(`${APPLICATIONS_BASE}/${created.id}/attachments`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .attach('file', Buffer.from('%PDF-1.4 a normal cv'), {
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      });

    const response = await request(app)
      .get('/api/v1/auth/me/usage')
      .set('Authorization', `Bearer ${user.accessToken}`);

    const stored = await Application.findById(created.id);

    expect(response.body.data.storageBytes.used).toBe(stored?.attachments[0].size);
    expect(response.body.data.storageBytes.used).toBeGreaterThan(0);
  });

  it('requires a session', async () => {
    const response = await request(app).get('/api/v1/auth/me/usage');

    expect(response.status).toBe(401);
  });
});
