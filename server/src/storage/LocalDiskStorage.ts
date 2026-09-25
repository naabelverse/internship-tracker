import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/config/env';
import { signDownload } from '@/storage/signing';
import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  ObjectNotFoundError,
  type PutObjectInput,
  type SignedUrlOptions,
  type StorageAdapter,
  type StoredObjectInfo,
} from '@/storage/StorageAdapter';

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

/**
 * Development and test driver. Never selected in production: the env loader
 * refuses to boot with STORAGE_DRIVER=local when NODE_ENV=production, because
 * the free tier hosts wipe local disk on every redeploy.
 */
export class LocalDiskStorage implements StorageAdapter {
  readonly driver = 'local' as const;

  private readonly root: string;

  readonly location: string;

  constructor(root: string = path.resolve(process.cwd(), env.UPLOAD_DIR)) {
    this.root = path.resolve(root);
    this.location = this.root;
  }

  /** Resolves a key inside the root, refusing anything that escapes it. */
  private resolveKey(key: string): string {
    const resolved = path.resolve(this.root, key);
    const boundary = this.root + path.sep;

    if (resolved !== this.root && !resolved.startsWith(boundary)) {
      throw new Error(`Storage key escapes the upload root: ${key}`);
    }

    return resolved;
  }

  async put({ key, body }: PutObjectInput): Promise<void> {
    const target = this.resolveKey(key);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (error) {
      if (isMissing(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // `force` keeps deletion idempotent, matching the S3 driver.
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolveKey(key), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A time limited URL to the file route, which streams the bytes with an
   * attachment disposition. Same expiry semantics as an S3 presigned URL, so
   * swapping drivers does not change how the client behaves.
   */
  signedUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const ttl = options.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS;
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;

    const url = new URL(`/api/v1/files/${key}`, env.API_URL);
    url.searchParams.set('expires', String(expiresAt));
    url.searchParams.set('signature', signDownload(key, expiresAt));
    if (options.downloadName) url.searchParams.set('name', options.downloadName);

    return Promise.resolve(url.toString());
  }

  /**
   * Walks the whole upload root and keeps keys that start with the prefix, so
   * a prefix matches the same way it does on S3: as a string, not a directory.
   */
  async list(prefix: string): Promise<StoredObjectInfo[]> {
    let entries;
    try {
      entries = await readdir(this.root, { recursive: true, withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }

    const keys = entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path.relative(this.root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
      )
      .filter((key) => key.startsWith(prefix));

    return Promise.all(
      keys.map(async (key) => {
        const info = await stat(this.resolveKey(key));
        return { key, size: info.size, lastModified: new Date(info.mtimeMs) };
      }),
    );
  }
}
