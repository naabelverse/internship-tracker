import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';

export const TEST_BUCKET = 'internship-tracker-test';

interface StoredObject {
  body: Buffer;
  contentType?: string;
}

function notFound(name: string): Error & { name: string; $metadata: { httpStatusCode: number } } {
  const error = new Error(name) as Error & { $metadata: { httpStatusCode: number } };
  error.name = name;
  error.$metadata = { httpStatusCode: 404 };
  return error as Error & { name: string; $metadata: { httpStatusCode: number } };
}

/**
 * An in-memory bucket behind the real AWS SDK client. Chosen over MinIO so the
 * contract suite needs no Docker daemon or network in CI. It proves S3Storage
 * issues the right commands and honours the adapter contract; it does not
 * exercise real S3 durability, IAM or eventual consistency.
 */
export function useInMemoryS3(): Map<string, StoredObject> {
  const contents = new Map<string, StoredObject>();
  const s3 = mockClient(S3Client);

  beforeEach(() => {
    s3.reset();
    contents.clear();

    s3.on(PutObjectCommand).callsFake(
      (input: { Key: string; Body: Buffer; ContentType?: string }) => {
        contents.set(input.Key, { body: Buffer.from(input.Body), contentType: input.ContentType });
        return {};
      },
    );

    s3.on(GetObjectCommand).callsFake((input: { Key: string }) => {
      const stored = contents.get(input.Key);
      if (!stored) throw notFound('NoSuchKey');

      return {
        Body: {
          transformToByteArray: (): Promise<Uint8Array> =>
            Promise.resolve(new Uint8Array(stored.body)),
        },
      };
    });

    s3.on(HeadObjectCommand).callsFake((input: { Key: string }) => {
      if (!contents.has(input.Key)) throw notFound('NotFound');
      return { ContentLength: contents.get(input.Key)?.body.length };
    });

    s3.on(DeleteObjectCommand).callsFake((input: { Key: string }) => {
      contents.delete(input.Key);
      return {};
    });
  });

  afterAll(() => {
    s3.restore();
  });

  return contents;
}
