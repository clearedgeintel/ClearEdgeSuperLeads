import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

// Wraps a Zod schema into Express middleware that validates req.body.
// On failure returns 400 with a list of `path: message` issues.
// On success replaces req.body with the parsed (and coerced) data.
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return res.status(400).json({ success: false, error: 'Validation failed', details });
    }
    req.body = result.data;
    next();
  };
}
