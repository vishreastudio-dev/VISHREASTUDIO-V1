import { sendError } from './http.js';
import { log } from './log.js';

// In-process fixed-window limiter. Correct for the single-process modular monolith;
// a multi-instance deployment needs a shared store (e.g. Redis) behind the same interface.
const buckets = new Map();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, 60_000);
sweeper.unref();

export function hit(key, { windowMs, max }) {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return { allowed: true, remaining: max, resetAt: Date.now() + windowMs };
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return { allowed: b.count <= max, remaining: Math.max(0, max - b.count), resetAt: b.resetAt };
}

export function rateLimit({ name, windowMs, max, key = (req) => req.ip, methods }) {
  return (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === 'true') return next();
    if (methods && !methods.includes(req.method)) return next();
    const k = `${name}:${key(req)}`;
    const r = hit(k, { windowMs, max });
    res.setHeader('RateLimit-Remaining', String(r.remaining));
    if (!r.allowed) {
      res.setHeader('Retry-After', String(Math.ceil((r.resetAt - Date.now()) / 1000)));
      log.warn('security.rate_limited', { limiter: name, ip: req.ip, path: req.path });
      return sendError(res, 429, 'rate_limited', 'Too many requests. Please wait a moment and try again.');
    }
    next();
  };
}

export function resetRateLimits() {
  buckets.clear();
}
