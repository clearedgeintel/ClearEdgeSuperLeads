// ClearEdge — Centralized Error Handler
const logger = require('../lib/logger');

function errorHandler(err, _req, res, _next) {
  logger.error({ err }, 'Unhandled error');

  if (err.status) {
    return res.status(err.status).json({ success: false, error: err.message });
  }

  res.status(500).json({ success: false, error: 'Internal server error' });
}

module.exports = { errorHandler };
