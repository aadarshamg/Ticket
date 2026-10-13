import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

export const LOGIN_MAX_FAILED_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Limits failed sign-in attempts per IP address. Successful sign-ins are not counted.
 * A new limiter (with its own counters) is created for each app instance.
 */
export function createLoginLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_MAX_FAILED_ATTEMPTS,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' },
      });
    },
  });
}
