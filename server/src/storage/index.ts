import { S3Client } from '@aws-sdk/client-s3';
import { env, isProduction } from '@/config/env';
import { LocalDiskStorage } from '@/storage/LocalDiskStorage';
import { S3Storage } from '@/storage/S3Storage';
import type { StorageAdapter } from '@/storage/StorageAdapter';

export * from '@/storage/StorageAdapter';
export { LocalDiskStorage } from '@/storage/LocalDiskStorage';
export { S3Storage } from '@/storage/S3Storage';

let cached: StorageAdapter | undefined;

export function createS3Client(): S3Client {
  if (!env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error('S3 storage selected but S3_REGION or the credentials are missing');
  }

  return new S3Client({
    region: env.S3_REGION,
    // A custom endpoint means an S3-compatible service such as Cloudflare R2,
    // which needs path style addressing rather than virtual hosted buckets.
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Chooses the driver from STORAGE_DRIVER. The production guard is deliberately
 * duplicated from the env loader: local disk on a free tier host is wiped on
 * every redeploy, so it must never be reachable by accident.
 */
export function createStorageAdapter(): StorageAdapter {
  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_BUCKET) throw new Error('S3 storage selected but S3_BUCKET is missing');
    return new S3Storage(env.S3_BUCKET, createS3Client());
  }

  if (isProduction) {
    throw new Error(
      'Local disk storage cannot be used in production: uploads would be lost on redeploy',
    );
  }

  return new LocalDiskStorage();
}

export function getStorage(): StorageAdapter {
  cached ??= createStorageAdapter();
  return cached;
}
