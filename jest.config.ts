import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['server/**/*.ts', 'shared/**/*.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@/(.*)$': '<rootDir>/client/src/$1',
  },
};

export default config;
