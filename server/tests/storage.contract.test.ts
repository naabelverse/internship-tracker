import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { LocalDiskStorage } from '@/storage/LocalDiskStorage';
import { S3Storage } from '@/storage/S3Storage';
import { ObjectNotFoundError, type StorageAdapter } from '@/storage/StorageAdapter';
import { TEST_BUCKET, useInMemoryS3 } from './helpers/s3Mock';

const KEY = 'attachments/64b7f0/abc123.pdf';
const TEXT = Buffer.from('a resume, more or less', 'utf8');
// A real PNG signature, so the round trip is proven on binary and not just text.
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x7f]);

/**
 * One suite, run against both drivers. Swapping STORAGE_DRIVER must change where
 * bytes live and nothing else, so every assertion here is driver agnostic.
 */
function contractSuite(name: string, getAdapter: () => StorageAdapter): void {
  describe(`${name} satisfies the storage contract`, () => {
    it('returns exactly the bytes that were written', async () => {
      const storage = getAdapter();

      await storage.put({ key: KEY, body: TEXT, contentType: 'application/pdf' });

      expect(await storage.get(KEY)).toEqual(TEXT);
    });

    it('round trips binary content unchanged', async () => {
      const storage = getAdapter();

      await storage.put({ key: 'attachments/logo.png', body: BINARY, contentType: 'image/png' });

      expect(await storage.get('attachments/logo.png')).toEqual(BINARY);
    });

    it('overwrites an existing key rather than failing', async () => {
      const storage = getAdapter();
      const replacement = Buffer.from('second version', 'utf8');

      await storage.put({ key: KEY, body: TEXT, contentType: 'application/pdf' });
      await storage.put({ key: KEY, body: replacement, contentType: 'application/pdf' });

      expect(await storage.get(KEY)).toEqual(replacement);
    });

    it('throws ObjectNotFoundError for a key that was never written', async () => {
      const storage = getAdapter();

      await expect(storage.get('attachments/missing.pdf')).rejects.toBeInstanceOf(
        ObjectNotFoundError,
      );
    });

    it('reports existence without throwing', async () => {
      const storage = getAdapter();

      expect(await storage.exists(KEY)).toBe(false);
      await storage.put({ key: KEY, body: TEXT, contentType: 'application/pdf' });
      expect(await storage.exists(KEY)).toBe(true);
    });

    it('deletes a stored object', async () => {
      const storage = getAdapter();

      await storage.put({ key: KEY, body: TEXT, contentType: 'application/pdf' });
      await storage.delete(KEY);

      expect(await storage.exists(KEY)).toBe(false);
      await expect(storage.get(KEY)).rejects.toBeInstanceOf(ObjectNotFoundError);
    });

    it('treats deleting an absent key as a no-op', async () => {
      const storage = getAdapter();

      await expect(storage.delete('attachments/never-existed.pdf')).resolves.toBeUndefined();
    });

    it('keeps separate keys independent', async () => {
      const storage = getAdapter();
      const other = Buffer.from('different file', 'utf8');

      await storage.put({ key: KEY, body: TEXT, contentType: 'application/pdf' });
      await storage.put({
        key: 'attachments/other.pdf',
        body: other,
        contentType: 'application/pdf',
      });
      await storage.delete(KEY);

      expect(await storage.exists('attachments/other.pdf')).toBe(true);
      expect(await storage.get('attachments/other.pdf')).toEqual(other);
    });

    it('issues an absolute signed URL that names the object', async () => {
      const storage = getAdapter();
      await storage.put({ key: KEY, body: TEXT, contentType: 'application/pdf' });

      const url = await storage.signedUrl(KEY, { expiresInSeconds: 60, downloadName: 'cv.pdf' });
      const parsed = new URL(url);

      expect(['http:', 'https:']).toContain(parsed.protocol);
      expect(decodeURIComponent(parsed.pathname)).toContain(KEY);
      expect(parsed.search.length).toBeGreaterThan(0);
    });

    it('reports its driver name', () => {
      expect(['local', 's3']).toContain(getAdapter().driver);
    });
  });
}

describe('storage adapters', () => {
  let root = '';
  let localStorage: LocalDiskStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'it-storage-'));
    localStorage = new LocalDiskStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  contractSuite('LocalDiskStorage', () => localStorage);

  it('refuses a key that escapes the upload root', async () => {
    await expect(
      localStorage.put({
        key: '../../escaped.txt',
        body: TEXT,
        contentType: 'text/plain',
      }),
    ).rejects.toThrow(/escapes the upload root/);
  });

  it('signs a local URL with an expiry and a signature', async () => {
    const url = new URL(await localStorage.signedUrl(KEY, { expiresInSeconds: 60 }));

    expect(url.searchParams.get('expires')).toMatch(/^\d+$/);
    expect(url.searchParams.get('signature')).toHaveLength(64);
  });
});

describe('S3Storage', () => {
  useInMemoryS3();

  const client = new S3Client({
    region: 'auto',
    credentials: { accessKeyId: 'test-key-id', secretAccessKey: 'test-secret-key' },
  });
  const s3Storage = new S3Storage(TEST_BUCKET, client);

  contractSuite('S3Storage', () => s3Storage);

  it('presigns with an expiry parameter', async () => {
    const url = new URL(await s3Storage.signedUrl(KEY, { expiresInSeconds: 120 }));

    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });
});
