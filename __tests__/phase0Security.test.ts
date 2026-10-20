// Phase 0 security cleanup: demo-login gating, apiKeyAuth fail-closed in
// production, and no logging of headers / sessions / OAuth tokens.

import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

// fallbackAuth imports storage, which imports db.ts (throws without
// DATABASE_URL). These tests never touch the database.
jest.mock('../server/storage', () => ({
  storage: { upsertUser: jest.fn(async (u: unknown) => u) },
}));

const ORIGINAL_ENV = { ...process.env };

// Pay the one-time ts-jest transform cost up front so the first test can't
// time out on a slow machine. Later isolateModules() requires hit the cache.
beforeAll(() => {
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    require('../server/fallbackAuth');
    require('../server/middleware/auth');
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
}, 120_000);

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function buildApp(): express.Express {
  let setupFallbackAuth!: typeof import('../server/fallbackAuth').setupFallbackAuth;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ setupFallbackAuth } = require('../server/fallbackAuth'));
  });
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: object }).session = {};
    next();
  });
  setupFallbackAuth(app);
  return app;
}

describe('demo login gating', () => {
  test('production without ENABLE_DEMO_LOGIN: demo-login 404s and config reports disabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_DEMO_LOGIN;
    const app = buildApp();

    await request(app).post('/api/auth/demo-login').expect(404);
    const res = await request(app).get('/api/auth/config').expect(200);
    expect(res.body).toEqual({ demoLoginEnabled: false });
  });

  test('production with ENABLE_DEMO_LOGIN=true: demo-login is available', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEMO_LOGIN = 'true';
    const app = buildApp();

    await request(app).post('/api/auth/demo-login').expect(200);
    const res = await request(app).get('/api/auth/config').expect(200);
    expect(res.body).toEqual({ demoLoginEnabled: true });
  });

  test('ENABLE_DEMO_LOGIN must be exactly "true"', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEMO_LOGIN = '1';
    const app = buildApp();
    await request(app).post('/api/auth/demo-login').expect(404);
  });

  test('development: demo-login is available', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_DEMO_LOGIN;
    const app = buildApp();

    await request(app).post('/api/auth/demo-login').expect(200);
    const res = await request(app).get('/api/auth/config').expect(200);
    expect(res.body).toEqual({ demoLoginEnabled: true });
  });
});

describe('apiKeyAuth fails closed in production', () => {
  function loadAuthModule() {
    let mod!: typeof import('../server/middleware/auth');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../server/middleware/auth');
    });
    return mod;
  }

  test('throws at module load in production when API_KEY is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.API_KEY;
    expect(loadAuthModule).toThrow(/API_KEY must be set in production/);
  });

  test('loads in production when API_KEY is set, and enforces it', async () => {
    process.env.NODE_ENV = 'production';
    process.env.API_KEY = 'test-key';
    const { apiKeyAuth } = loadAuthModule();
    const app = express();
    app.get('/hook', apiKeyAuth, (_req, res) => res.json({ ok: true }));

    await request(app).get('/hook').expect(401);
    await request(app).get('/hook').set('x-api-key', 'wrong').expect(401);
    await request(app).get('/hook').set('x-api-key', 'test-key').expect(200);
  });

  test('dev without API_KEY stays a no-op', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.API_KEY;
    const { apiKeyAuth } = loadAuthModule();
    const app = express();
    app.get('/hook', apiKeyAuth, (_req, res) => res.json({ ok: true }));
    await request(app).get('/hook').expect(200);
  });
});

describe('no secret logging in server code', () => {
  function listTsFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listTsFiles(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });
  }

  const serverDir = path.join(__dirname, '..', 'server');
  const files = listTsFiles(serverDir);
  // A log call whose arguments reference headers, cookies, the session, or
  // an OAuth tokens object.
  const LOG_CALL = /\b(console|logger)\.(log|info|debug|warn|error|trace)\(([^;]*)/g;
  const SENSITIVE = /req\.(headers|cookies|session)\b|\btokens\b(?!\s*\.\s*(length|size))|access_token|refresh_token|authorization/i;

  test('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  test('no console/logger call logs headers, cookies, sessions or tokens', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(LOG_CALL)) {
        // Only the code arguments matter; ignore text inside string literals.
        const args = m[3].replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
        if (SENSITIVE.test(args)) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${path.relative(serverDir, file)}:${line}: ${m[0].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no debug auth routes are registered', () => {
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toMatch(/['"`]\/api\/test-callback|['"`]\/auth\/test\b/);
    }
  });
});
