// ClearEdge — Zod Validation Middleware
// Wraps a Zod schema into Express middleware that validates req.body

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const messages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return res
        .status(400)
        .json({ success: false, error: 'Validation failed', details: messages });
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
