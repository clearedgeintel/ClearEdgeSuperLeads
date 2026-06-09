// Plain ESM config (the project is "type": "module"). Kept as .mjs rather than
// .ts so Jest doesn't need ts-node just to PARSE its own config — ts-jest still
// transforms the .ts test files via the preset below. (A .ts config requires
// ts-node, which isn't a dependency and broke `npm ci` CI runs.)

/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testTimeout: 30_000,
  collectCoverageFrom: ['server/**/*.ts', 'shared/**/*.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@/(.*)$': '<rootDir>/client/src/$1',
    '^nanoid$': '<rootDir>/__tests__/__mocks__/nanoid.ts',
  },
};
