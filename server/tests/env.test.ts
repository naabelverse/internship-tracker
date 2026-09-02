import { EXAMPLE_SECRET_VALUES, MIN_SECRET_LENGTH, parseEnv } from '@/config/env';

const validSecretA = 'A'.repeat(MIN_SECRET_LENGTH + 8);
const validSecretB = 'B'.repeat(MIN_SECRET_LENGTH + 8);

const minimalEnv = (): NodeJS.ProcessEnv =>
  ({
    MONGO_URI: 'mongodb://127.0.0.1:27017/internship_tracker',
    JWT_ACCESS_SECRET: validSecretA,
    JWT_REFRESH_SECRET: validSecretB,
  }) as NodeJS.ProcessEnv;

const productionEnv = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({
    ...minimalEnv(),
    NODE_ENV: 'production',
    CLIENT_ORIGIN: 'https://tracker.example.com',
    APP_URL: 'https://tracker.example.com',
    API_URL: 'https://api.tracker.example.com',
    // Production refuses local disk storage, so a complete production
    // configuration has to name a bucket and its credentials.
    STORAGE_DRIVER: 's3',
    S3_REGION: 'auto',
    S3_BUCKET: 'tracker-uploads',
    S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    S3_SECRET_ACCESS_KEY: 'secret-example-value',
    ...overrides,
  }) as NodeJS.ProcessEnv;

describe('env loader', () => {
  describe('development', () => {
    it('boots with only MONGO_URI and the two JWT secrets', () => {
      const env = parseEnv(minimalEnv());

      expect(env.NODE_ENV).toBe('development');
      expect(env.PORT).toBe(5000);
      expect(env.ACCESS_TOKEN_TTL).toBe('15m');
      expect(env.REFRESH_TOKEN_TTL).toBe('7d');
      expect(env.CLIENT_ORIGIN).toBe('http://localhost:5173');
      expect(env.TRUST_PROXY).toBe(0);
    });

    it('tolerates short and placeholder secrets outside production', () => {
      expect(() =>
        parseEnv({
          ...minimalEnv(),
          JWT_ACCESS_SECRET: 'short',
          JWT_REFRESH_SECRET: EXAMPLE_SECRET_VALUES[0],
        } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });

    it('coerces numeric variables from their string form', () => {
      const env = parseEnv({
        ...minimalEnv(),
        PORT: '8080',
        TRUST_PROXY: '1',
      } as NodeJS.ProcessEnv);

      expect(env.PORT).toBe(8080);
      expect(env.TRUST_PROXY).toBe(1);
    });
  });

  describe('missing configuration', () => {
    it('throws when MONGO_URI is absent', () => {
      const { MONGO_URI: _omitted, ...rest } = minimalEnv();

      expect(() => parseEnv(rest as NodeJS.ProcessEnv)).toThrow(/MONGO_URI/);
    });

    it('reports every problem in a single error', () => {
      expect(() => parseEnv({} as NodeJS.ProcessEnv)).toThrow(
        /MONGO_URI[\s\S]*JWT_ACCESS_SECRET[\s\S]*JWT_REFRESH_SECRET/,
      );
    });
  });

  describe('storage configuration', () => {
    it('requires the S3 settings whenever the S3 driver is selected', () => {
      expect(() =>
        parseEnv({ ...minimalEnv(), STORAGE_DRIVER: 's3' } as NodeJS.ProcessEnv),
      ).toThrow(/S3_BUCKET[\s\S]*required when STORAGE_DRIVER is s3/);
    });

    it('defaults to local disk outside production', () => {
      expect(parseEnv(minimalEnv()).STORAGE_DRIVER).toBe('local');
    });
  });

  describe('production hardening', () => {
    it('accepts a fully configured production environment', () => {
      const env = parseEnv(productionEnv());

      expect(env.NODE_ENV).toBe('production');
      expect(env.CLIENT_ORIGIN).toBe('https://tracker.example.com');
    });

    it('rejects a secret shorter than the minimum length', () => {
      expect(() => parseEnv(productionEnv({ JWT_ACCESS_SECRET: 'too-short' }))).toThrow(
        new RegExp(`JWT_ACCESS_SECRET.*${MIN_SECRET_LENGTH} characters`),
      );
    });

    it('rejects a secret left at its .env.example placeholder', () => {
      const placeholder = EXAMPLE_SECRET_VALUES[0];

      expect(() => parseEnv(productionEnv({ JWT_ACCESS_SECRET: placeholder }))).toThrow(
        /placeholder value/,
      );
    });

    it('rejects reusing one secret for both tokens', () => {
      expect(() => parseEnv(productionEnv({ JWT_REFRESH_SECRET: validSecretA }))).toThrow(
        /must differ from JWT_ACCESS_SECRET/,
      );
    });

    it('refuses local disk storage, which a free tier host would wipe on redeploy', () => {
      expect(() => parseEnv(productionEnv({ STORAGE_DRIVER: 'local' }))).toThrow(/ephemeral disks/);
    });

    it('rejects a localhost client origin', () => {
      expect(() => parseEnv(productionEnv({ CLIENT_ORIGIN: 'http://localhost:5173' }))).toThrow(
        /not localhost/,
      );
    });
  });
});
