import sharp from 'sharp';
import request from 'supertest';
import { Application } from '@/models/Application';
import { getStorage } from '@/storage';
import {
  APPLICATIONS_BASE,
  buildTestApp,
  createApplicationFor,
  registerUser,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

const PDF = Buffer.from('%PDF-1.7\nnot really a pdf but close enough\n', 'utf8');

const attach = (
  id: string,
  token: string,
  body: Buffer,
  filename: string,
  contentType: string,
): request.Test =>
  request(app)
    .post(`${APPLICATIONS_BASE}/${id}/attachments`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', body, { filename, contentType });

async function storageKeyOf(applicationId: string): Promise<string> {
  const application = await Application.findById(applicationId);
  const key = application?.attachments[0]?.filename;
  if (!key) throw new Error('no attachment stored');
  return key;
}

describe('attachments', () => {
  it('stores a PDF under a generated key and keeps the original name for display', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);

    const response = await attach(
      application.id,
      accessToken,
      PDF,
      'My CV (final).pdf',
      'application/pdf',
    );

    expect(response.status).toBe(201);
    const [attachment] = response.body.data.application.attachments as Record<string, unknown>[];
    expect(attachment).toMatchObject({
      originalName: 'My CV (final).pdf',
      mimeType: 'application/pdf',
      size: PDF.length,
    });
    // The storage key stays server side.
    expect(attachment.filename).toBeUndefined();

    const key = await storageKeyOf(application.id);
    expect(key).not.toContain('My CV');
    expect(key).toMatch(/^attachments\/[a-f0-9]{24}\/[a-f0-9]{24}\/[a-f0-9-]{36}\.pdf$/);
    expect(await getStorage().get(key)).toEqual(PDF);
  });

  it('rejects an upload with no file attached', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);

    // Multer leaves `req.file` undefined rather than failing, so without this
    // guard the request would reach the service and throw on a missing mimetype.
    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/${application.id}/attachments`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('FILE_REQUIRED');

    const stored = await Application.findById(application.id);
    expect(stored?.attachments).toHaveLength(0);
  });

  it('rejects a file type that is not on the allow list', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);

    const response = await attach(
      application.id,
      accessToken,
      Buffer.from('rm -rf /', 'utf8'),
      'evil.sh',
      'application/x-sh',
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects a file over the size limit', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);

    const response = await attach(
      application.id,
      accessToken,
      Buffer.alloc(6 * 1024 * 1024, 1),
      'huge.pdf',
      'application/pdf',
    );

    expect(response.status).toBe(413);
    expect(response.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('strips EXIF metadata from an uploaded image', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);

    const withExif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'exif-marker-should-not-survive' } } })
      .toBuffer();

    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    await attach(application.id, accessToken, withExif, 'photo.jpg', 'image/jpeg');

    const stored = await getStorage().get(await storageKeyOf(application.id));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.toString('latin1')).not.toContain('exif-marker-should-not-survive');
  });

  it('hides another account application from the upload route', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const application = await createApplicationFor(app, alice.accessToken);

    const response = await attach(
      application.id,
      bob.accessToken,
      PDF,
      'cv.pdf',
      'application/pdf',
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('APPLICATION_NOT_FOUND');
  });
});

describe('attachment download links', () => {
  it('mints a signed URL that serves the bytes as an attachment', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);
    const uploaded = await attach(application.id, accessToken, PDF, 'cv.pdf', 'application/pdf');
    const attachmentId = uploaded.body.data.application.attachments[0].id as string;

    const link = await request(app)
      .get(`${APPLICATIONS_BASE}/${application.id}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(link.status).toBe(200);
    expect(link.body.data.filename).toBe('cv.pdf');
    expect(link.body.data.expiresInSeconds).toBeGreaterThan(0);

    const url = new URL(link.body.data.url as string);
    const download = await request(app).get(`${url.pathname}${url.search}`);

    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(download.body as Buffer)).toEqual(PDF);
  });

  it('refuses a tampered signature with the same 404 as an unknown key', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);
    const uploaded = await attach(application.id, accessToken, PDF, 'cv.pdf', 'application/pdf');
    const attachmentId = uploaded.body.data.application.attachments[0].id as string;

    const link = await request(app)
      .get(`${APPLICATIONS_BASE}/${application.id}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    const url = new URL(link.body.data.url as string);
    url.searchParams.set('signature', 'f'.repeat(64));

    const tampered = await request(app).get(`${url.pathname}${url.search}`);
    const unknown = await request(app).get('/api/v1/files/attachments/does/not/exist.pdf');

    expect(tampered.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(tampered.body.code).toBe(unknown.body.code);
  });

  it('refuses an expired link', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);
    const uploaded = await attach(application.id, accessToken, PDF, 'cv.pdf', 'application/pdf');
    const attachmentId = uploaded.body.data.application.attachments[0].id as string;

    const link = await request(app)
      .get(`${APPLICATIONS_BASE}/${application.id}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    const url = new URL(link.body.data.url as string);
    url.searchParams.set('expires', String(Math.floor(Date.now() / 1000) - 10));

    const response = await request(app).get(`${url.pathname}${url.search}`);

    expect(response.status).toBe(404);
  });

  it('removes the stored object when the attachment is deleted', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);
    const uploaded = await attach(application.id, accessToken, PDF, 'cv.pdf', 'application/pdf');
    const attachmentId = uploaded.body.data.application.attachments[0].id as string;
    const key = await storageKeyOf(application.id);

    const response = await request(app)
      .delete(`${APPLICATIONS_BASE}/${application.id}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.application.attachments).toHaveLength(0);
    expect(await getStorage().exists(key)).toBe(false);
  });

  it('returns 404 for an attachment id that is not on the record', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}/${application.id}/attachments/64b7f0000000000000000000`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ATTACHMENT_NOT_FOUND');
  });
});
