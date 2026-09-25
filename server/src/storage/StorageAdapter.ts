export type StorageDriver = 'local' | 's3';

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface SignedUrlOptions {
  expiresInSeconds?: number;
  /** Filename the browser should save as, sent through Content-Disposition. */
  downloadName?: string;
}

/** One entry of a `list` result. */
export interface StoredObjectInfo {
  /** The full key, always with forward slashes, whatever the host OS. */
  key: string;
  size: number;
  lastModified: Date;
}

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

/** Raised by `get` when the key is absent, so callers do not have to read errno. */
export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Stored object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

/**
 * The seam between the application and wherever bytes actually live.
 *
 * The contract every implementation must satisfy, and which the shared contract
 * suite asserts against both of them:
 *  - `put` overwrites an existing key rather than failing.
 *  - `get` returns the exact bytes written, or throws ObjectNotFoundError.
 *  - `delete` is idempotent: deleting an absent key is not an error.
 *  - `exists` never throws for an absent key, it returns false.
 *  - `signedUrl` returns a URL that expires, and never exposes a bucket listing.
 *  - `list` returns every object whose key starts with the prefix, in no
 *    particular order, following pagination to the end. It is read-only and
 *    exists for operator scripts; no request path calls it.
 */
export interface StorageAdapter {
  readonly driver: StorageDriver;
  /** Where objects live, for operator output: the bucket name or the local root. */
  readonly location: string;
  put(input: PutObjectInput): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  list(prefix: string): Promise<StoredObjectInfo[]>;
}
