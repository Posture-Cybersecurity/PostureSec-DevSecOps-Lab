/**
 * Fixed-window limit per client address. A burst that would make one caller
 * monopolise the API is refused with 429; ordinary sequential use stays under it.
 * In-memory and process-local, which matches this single-node lab.
 */
const WINDOW_MS = 1000;
const MAX_PER_WINDOW = 40;
const buckets = new Map();

function rateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > MAX_PER_WINDOW) {
    res.set('Retry-After', '1');
    return res.status(429).json({ error: 'Too many requests' });
  }
  return next();
}

module.exports = { rateLimit };
