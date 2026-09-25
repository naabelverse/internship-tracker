import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Types } from 'mongoose';
import { Application } from '@/models/Application';
import { parseSweepArgs, runStorageSweep } from '@/scripts/storageSweep';
import {
  classifyStoredObjects,
  isGeneratedAttachmentKey,
  SWEEP_MIN_AGE_MS,
  SweepRefusedError,
} from '@/services/storageSweep.service';
import { LocalDiskStorage } from '@/storage/LocalDiskStorage';
import type { StoredObjectInfo } from '@/storage/StorageAdapter';
import {
  buildTestApp,
  createApplicationFor,
  registerUser,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-09-25T12:00:00Z');

/** A key shaped exactly like the ones `addAttachment` generates. */
function buildGeneratedKey(
  userId = new Types.ObjectId().toString(),
  applicationId = new Types.ObjectId().toString(),
  extension = 'pdf',
): string {
  return `attachments/${userId}/${applicationId}/${randomUUID()}.${extension}`;
}

function buildStoredObject(overrides: Partial<StoredObjectInfo> = {}): StoredObjectInfo {
  return {
    key: buildGeneratedKey(),
    size: 1024,
    lastModified: new Date(NOW.getTime() - 48 * HOUR_MS),
    ...overrides,
  };
}

describe('isGeneratedAttachmentKey', () => {
  it('accepts a key in the shape addAttachment generates', () => {
    for (const extension of ['pdf', 'doc', 'docx', 'png', 'jpg']) {
      expect(isGeneratedAttachmentKey(buildGeneratedKey(undefined, undefined, extension))).toBe(
        true,
      );
    }
  });

  it.each([
    ['a different top-level prefix', `exports/${randomUUID()}.pdf`],
    ['a missing application segment', `attachments/${new Types.ObjectId().toString()}/x.pdf`],
    [
      'a name that is not a UUID',
      `attachments/${new Types.ObjectId().toString()}/${new Types.ObjectId().toString()}/cv.pdf`,
    ],
    ['an extension uploads never get', buildGeneratedKey(undefined, undefined, 'exe')],
    ['an extra path segment', `${buildGeneratedKey()}/extra`],
    ['a user segment that is not an ObjectId', `attachments/me/${randomUUID()}.pdf`],
  ])('rejects %s', (_label, key) => {
    expect(isGeneratedAttachmentKey(key)).toBe(false);
  });
});

describe('classifyStoredObjects', () => {
  it('keeps an object that a document still references', () => {
    const object = buildStoredObject();

    const result = classifyStoredObjects([object], new Set([object.key]), NOW);

    expect(result.referenced).toEqual([object]);
    expect(result.orphans).toEqual([]);
  });

  it('marks an unreferenced object older than 24 hours as an orphan', () => {
    const object = buildStoredObject();

    const result = classifyStoredObjects([object], new Set(), NOW);

    expect(result.orphans).toEqual([object]);
  });

  it('holds back an unreferenced object that is exactly 24 hours old', () => {
    const object = buildStoredObject({ lastModified: new Date(NOW.getTime() - SWEEP_MIN_AGE_MS) });

    const result = classifyStoredObjects([object], new Set(), NOW);

    expect(result.recent).toEqual([object]);
    expect(result.orphans).toEqual([]);
  });

  it('holds back an unreferenced object uploaded an hour ago', () => {
    const object = buildStoredObject({ lastModified: new Date(NOW.getTime() - HOUR_MS) });

    const result = classifyStoredObjects([object], new Set(), NOW);

    expect(result.recent).toEqual([object]);
  });

  it('never treats a key it did not generate as an orphan', () => {
    const object = buildStoredObject({ key: 'attachments/hand-placed/readme.txt' });

    const result = classifyStoredObjects([object], new Set(), NOW);

    expect(result.unrecognised).toEqual([object]);
    expect(result.orphans).toEqual([]);
  });

  it('keeps a referenced key even when it does not match the generated pattern', () => {
    const object = buildStoredObject({ key: 'attachments/legacy/cv.pdf' });

    const result = classifyStoredObjects([object], new Set([object.key]), NOW);

    expect(result.referenced).toEqual([object]);
    expect(result.unrecognised).toEqual([]);
  });
});

describe('parseSweepArgs', () => {
  it('is a dry run by default', () => {
    expect(parseSweepArgs([])).toEqual({ apply: false, allowMajority: false });
  });

  it('reads --apply with the expected count', () => {
    expect(parseSweepArgs(['--apply', '--expect', '3'])).toEqual({
      apply: true,
      expect: 3,
      allowMajority: false,
    });
  });

  it('reads --allow-majority', () => {
    expect(parseSweepArgs(['--apply', '--expect', '0', '--allow-majority']).allowMajority).toBe(
      true,
    );
  });

  it.each([
    ['a count that is not a whole number', ['--apply', '--expect', 'three']],
    ['a negative count', ['--apply', '--expect', '-1']],
    ['--expect without --apply', ['--expect', '3']],
    ['--allow-majority without --apply', ['--allow-majority']],
    ['an unknown flag', ['--force']],
  ])('rejects %s', (_label, argv) => {
    expect(() => parseSweepArgs(argv)).toThrow();
  });
});

describe('runStorageSweep', () => {
  useTestDatabase();
  useCleanAuthRateLimits();

  const app = buildTestApp();
  let root = '';
  let storage: LocalDiskStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'it-sweep-'));
    storage = new LocalDiskStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  interface Owner {
    userId: string;
    applicationId: string;
  }

  async function createOwner(): Promise<Owner> {
    const user = await registerUser(app);
    const application = await createApplicationFor(app, user.accessToken);
    return { userId: user.userId, applicationId: application.id };
  }

  /**
   * Stores a file under a generated key, optionally records it on the owner's
   * application, and backdates its modification time by `ageHours`.
   */
  async function storeFile(
    owner: Owner,
    {
      referenced,
      ageHours,
      bytes = 100,
    }: { referenced: boolean; ageHours: number; bytes?: number },
  ): Promise<string> {
    const key = buildGeneratedKey(owner.userId, owner.applicationId);
    await storage.put({ key, body: Buffer.alloc(bytes), contentType: 'application/pdf' });

    const modified = new Date(Date.now() - ageHours * HOUR_MS);
    await utimes(path.join(root, key), modified, modified);

    if (referenced) {
      await Application.updateOne(
        { _id: owner.applicationId },
        {
          $push: {
            attachments: {
              filename: key,
              originalName: 'cv.pdf',
              mimeType: 'application/pdf',
              size: bytes,
              url: `/api/v1/applications/${owner.applicationId}/attachments`,
            },
          },
        },
      );
    }

    return key;
  }

  /** Two referenced files, one old orphan, one fresh orphan and one unrecognised key. */
  async function seedMixedBucket(): Promise<Record<string, string>> {
    const owner = await createOwner();
    const referenced = await storeFile(owner, { referenced: true, ageHours: 72 });
    const referencedToo = await storeFile(owner, { referenced: true, ageHours: 72 });
    const orphan = await storeFile(owner, { referenced: false, ageHours: 72, bytes: 250 });
    const fresh = await storeFile(owner, { referenced: false, ageHours: 1 });
    const unrecognised = 'attachments/hand-placed/readme.txt';
    await storage.put({ key: unrecognised, body: Buffer.alloc(10), contentType: 'text/plain' });

    return { referenced, referencedToo, orphan, fresh, unrecognised, userId: owner.userId };
  }

  async function storedKeys(): Promise<string[]> {
    return (await storage.list('attachments/')).map((object) => object.key).sort();
  }

  it('reports orphans on a dry run and deletes nothing', async () => {
    const seeded = await seedMixedBucket();
    const before = await storedKeys();

    const result = await runStorageSweep({ apply: false, allowMajority: false }, { storage });

    expect(result.plan.orphans.map((object) => object.key)).toEqual([seeded.orphan]);
    expect(result.erasure).toBeUndefined();
    expect(result.output).toContain('250 bytes');
    expect(result.output).toContain(seeded.userId);
    expect(result.output).toContain(seeded.orphan);
    expect(result.output).toContain(seeded.unrecognised);
    expect(result.output).toMatch(/dry run/i);
    expect(await storedKeys()).toEqual(before);
  });

  it('deletes only unreferenced generated keys older than 24 hours with --apply', async () => {
    const seeded = await seedMixedBucket();

    const result = await runStorageSweep(
      { apply: true, expect: 1, allowMajority: false },
      { storage },
    );

    expect(result.erasure).toEqual({ erased: 1, failed: 0 });
    expect(await storedKeys()).toEqual(
      [seeded.referenced, seeded.referencedToo, seeded.fresh, seeded.unrecognised].sort(),
    );
  });

  it('refuses --apply when the orphan count differs from --expect', async () => {
    await seedMixedBucket();
    const before = await storedKeys();

    await expect(
      runStorageSweep({ apply: true, expect: 2, allowMajority: false }, { storage }),
    ).rejects.toThrow(SweepRefusedError);
    expect(await storedKeys()).toEqual(before);
  });

  it('refuses --apply without --expect', async () => {
    await seedMixedBucket();
    const before = await storedKeys();

    await expect(
      runStorageSweep({ apply: true, allowMajority: false }, { storage }),
    ).rejects.toThrow(SweepRefusedError);
    expect(await storedKeys()).toEqual(before);
  });

  it('refuses --apply against a database with no applications', async () => {
    const owner = await createOwner();
    const orphan = await storeFile(owner, { referenced: false, ageHours: 72 });
    await Application.deleteMany({});

    await expect(
      runStorageSweep({ apply: true, expect: 1, allowMajority: true }, { storage }),
    ).rejects.toThrow(/no applications/i);
    expect(await storedKeys()).toEqual([orphan]);
  });

  it('warns on a dry run against a database with no applications', async () => {
    const owner = await createOwner();
    await storeFile(owner, { referenced: false, ageHours: 72 });
    await Application.deleteMany({});

    const result = await runStorageSweep({ apply: false, allowMajority: false }, { storage });

    expect(result.output).toMatch(/no applications/i);
  });

  it('refuses --apply when orphans are the majority of stored files', async () => {
    const owner = await createOwner();
    await storeFile(owner, { referenced: true, ageHours: 72 });
    await storeFile(owner, { referenced: false, ageHours: 72 });
    await storeFile(owner, { referenced: false, ageHours: 72 });
    const before = await storedKeys();

    await expect(
      runStorageSweep({ apply: true, expect: 2, allowMajority: false }, { storage }),
    ).rejects.toThrow(/majority/i);
    expect(await storedKeys()).toEqual(before);
  });

  it('deletes a majority of files when --allow-majority is given', async () => {
    const owner = await createOwner();
    const kept = await storeFile(owner, { referenced: true, ageHours: 72 });
    await storeFile(owner, { referenced: false, ageHours: 72 });
    await storeFile(owner, { referenced: false, ageHours: 72 });

    const result = await runStorageSweep(
      { apply: true, expect: 2, allowMajority: true },
      { storage },
    );

    expect(result.erasure).toEqual({ erased: 2, failed: 0 });
    expect(await storedKeys()).toEqual([kept]);
  });

  it('reports a file it could not delete as a failure', async () => {
    const seeded = await seedMixedBucket();
    jest.spyOn(storage, 'delete').mockRejectedValue(new Error('storage unavailable'));

    const result = await runStorageSweep(
      { apply: true, expect: 1, allowMajority: false },
      { storage },
    );

    expect(result.erasure).toEqual({ erased: 0, failed: 1 });
    expect(await storedKeys()).toContain(seeded.orphan);
  });
});
