// ClearEdge — LinkedIn-specific Rate Limiter
// Enforces per-account hourly limits and adds human-like delays between actions.
const logger = require('./logger');
const { sleep } = require('./retry');

const hourlyLimits = {
  search: parseInt(process.env.LINKEDIN_SEARCH_LIMIT_HOURLY) || 15,
  dispatch: parseInt(process.env.LINKEDIN_DISPATCH_LIMIT_HOURLY) || 25,
  email: parseInt(process.env.EMAIL_DISPATCH_LIMIT_HOURLY) || 30,
};

// In-memory counters (reset hourly)
const counters = { search: [], dispatch: [], email: [] };

function pruneOld(list) {
  const oneHourAgo = Date.now() - 3600000;
  while (list.length > 0 && list[0] < oneHourAgo) list.shift();
}

/**
 * Check if an action is allowed under hourly limits.
 * @param {'search'|'dispatch'} action
 * @returns {boolean}
 */
function isAllowed(action) {
  const list = counters[action];
  if (!list) return true;
  pruneOld(list);
  return list.length < hourlyLimits[action];
}

/**
 * Record that an action was taken.
 * @param {'search'|'dispatch'} action
 */
function record(action) {
  if (!counters[action]) return;
  counters[action].push(Date.now());
}

/**
 * Get remaining quota for an action.
 * @param {'search'|'dispatch'} action
 */
function remaining(action) {
  const list = counters[action];
  if (!list) return Infinity;
  pruneOld(list);
  return Math.max(0, hourlyLimits[action] - list.length);
}

/**
 * Add a randomized human-like delay (2–6 seconds).
 */
async function humanDelay() {
  const ms = 2000 + Math.random() * 4000;
  logger.debug({ delay: Math.round(ms) }, 'Human-like delay');
  await sleep(ms);
}

module.exports = { isAllowed, record, remaining, humanDelay, hourlyLimits };
