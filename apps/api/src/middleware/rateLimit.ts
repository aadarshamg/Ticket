import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

export const LOGIN_MAX_FAILED_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const LOOKUP_MAX_FAILED_ATTEMPTS = 30;
const LOOKUP_WINDOW_MS = 5 * 60 * 1000;

const tooMany = (message: string) => ({ error: { code: 'rate_limited', message } });

/**
 * Limits guessing of pass links: counts only lookups that fail (unknown code), per IP address.
 * Successful lookups are never limited, because at the venue hundreds of real attendees can
 * share one mobile-network IP address.
 */
export function createLookupLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: LOOKUP_WINDOW_MS,
    limit: LOOKUP_MAX_FAILED_ATTEMPTS,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(tooMany('Too many attempts. Try again in a few minutes.'));
    },
  });
}

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
