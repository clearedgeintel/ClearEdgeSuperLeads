const { validate } = require('../middleware/validate');
const { apiKeyAuth } = require('../middleware/auth');
const { z } = require('zod');

// Helper to create mock req/res/next
function mockExpress(overrides = {}) {
  const req = { body: {}, headers: {}, ...overrides };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('validate middleware', () => {
  const schema = z.object({
    name: z.string(),
    age: z.number().int().positive(),
  });

  test('passes valid input and calls next', () => {
    const { req, res, next } = mockExpress({ body: { name: 'Alice', age: 30 } });
    validate(schema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: 'Alice', age: 30 });
  });

  test('rejects invalid input with 400', () => {
    const { req, res, next } = mockExpress({ body: { name: 123 } });
    validate(schema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toBeDefined();
  });

  test('strips unknown fields', () => {
    const { req, res, next } = mockExpress({ body: { name: 'Bob', age: 25, extra: true } });
    validate(schema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body.extra).toBeUndefined();
  });
});

describe('apiKeyAuth middleware', () => {
  const originalEnv = process.env.API_KEY;

  afterEach(() => {
    process.env.API_KEY = originalEnv;
  });

  test('skips auth when API_KEY is not set', () => {
    delete process.env.API_KEY;
    const { req, res, next } = mockExpress();
    apiKeyAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows valid API key', () => {
    process.env.API_KEY = 'test-secret';
    const { req, res, next } = mockExpress({ headers: { 'x-api-key': 'test-secret' } });
    apiKeyAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('rejects missing API key with 401', () => {
    process.env.API_KEY = 'test-secret';
    const { req, res, next } = mockExpress();
    apiKeyAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('rejects wrong API key with 401', () => {
    process.env.API_KEY = 'test-secret';
    const { req, res, next } = mockExpress({ headers: { 'x-api-key': 'wrong' } });
    apiKeyAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
