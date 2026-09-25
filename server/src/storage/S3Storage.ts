import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  ObjectNotFoundError,
  type PutObjectInput,
  type SignedUrlOptions,
  type StorageAdapter,
  type StoredObjectInfo,
} from '@/storage/StorageAdapter';

interface AwsErrorShape {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

function isNotFound(error: unknown): boolean {
  const shape = error as AwsErrorShape;
  return (
    shape.name === 'NoSuchKey' ||
    shape.name === 'NotFound' ||
    shape.$metadata?.httpStatusCode === 404
  );
}

/**
 * Production driver. Works against AWS S3 and any S3-compatible endpoint such as
 * Cloudflare R2. Objects are private: the only way to read one is a presigned
 * URL with an expiry, so the bucket is never publicly listable.
 */
export class S3Storage implements StorageAdapter {
  readonly driver = 's3' as const;

  private readonly client: S3Client;

  private readonly bucket: string;

  constructor(bucket: string, client: S3Client) {
    this.bucket = bucket;
    this.client = client;
  }

  async put({ key, body, contentType }: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Belt and braces: the bucket policy should already deny public reads.
        ACL: 'private',
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      if (!response.Body) throw new ObjectNotFoundError(key);

      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 delete is already idempotent and returns 204 for an absent key.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  signedUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: options.downloadName
        ? `attachment; filename="${options.downloadName}"`
        : 'attachment',
    });

    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS,
    });
  }

  async list(prefix: string): Promise<StoredObjectInfo[]> {
    const objects: StoredObjectInfo[] = [];
    let continuationToken: string | undefined;

    // ListObjectsV2 returns at most 1000 keys a page, so follow the token to the end.
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        objects.push({
          key: object.Key,
          size: object.Size ?? 0,
          lastModified: object.LastModified ?? new Date(0),
        });
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return objects;
  }
}
