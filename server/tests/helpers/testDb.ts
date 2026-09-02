import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { RefreshToken } from '@/models/RefreshToken';
import { User } from '@/models/User';

const BOOT_TIMEOUT_MS = 300_000;

/**
 * Registers an in-memory MongoDB lifecycle for the calling suite. Collections are
 * emptied after every test so cases cannot leak state into each other.
 */
export function useTestDatabase(): void {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    // Unique indexes have to exist before duplicate-key behaviour can be tested.
    await Promise.all([User.init(), RefreshToken.init()]);
  }, BOOT_TIMEOUT_MS);

  afterEach(async () => {
    await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod?.stop();
  });
}
