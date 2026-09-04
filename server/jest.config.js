/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  // SPEC section 10 sets the target on these two directories specifically.
  // Directory keys aggregate, unlike glob keys which apply per file, so this is
  // the same number the spec asks for. Pinned here rather than eyeballed once,
  // so a later phase that adds an untested service fails CI instead of drifting.
  coverageThreshold: {
    './src/services/': { statements: 70, lines: 70, functions: 70, branches: 60 },
    './src/controllers/': { statements: 70, lines: 70, functions: 70, branches: 60 },
  },
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30000,
  verbose: false,
};
