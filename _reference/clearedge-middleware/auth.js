// ClearEdge — API Key Authentication Middleware
// If API_KEY is set in env, all /api/* requests must include it in the X-API-Key header.
// If API_KEY is not set, authentication is disabled (open access).

function apiKeyAuth(req, res, next) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return next(); // Auth disabled if no key configured

  const provided = req.headers['x-api-key'];
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
}

module.exports = { apiKeyAuth };
