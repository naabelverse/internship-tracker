import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Application } from '@/models/Application';
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
    // Indexes have to exist before unique and text behaviour can be tested.
    await Promise.all([User.init(), RefreshToken.init(), Application.init()]);
  }, BOOT_TIMEOUT_MS);

  afterEach(async () => {
    // Every collection, not a hand-written list: a model added in a later phase
    // would otherwise leak rows between tests and mask real failures.
    const collections = Object.values(mongoose.connection.collections);
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod?.stop();
  });
}
