import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

export const LOGIN_MAX_FAILED_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const GATE_LOGIN_MAX_FAILED_ATTEMPTS = 20;
const GATE_LOGIN_WINDOW_MS = 10 * 60 * 1000;

/**
 * Limits wrong gate PINs per IP address. Looser than the admin limit because every volunteer
 * at the venue may share one Wi-Fi address; use 6-digit PINs so guessing stays impractical.
 */
export function createGateLoginLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: GATE_LOGIN_WINDOW_MS,
    limit: GATE_LOGIN_MAX_FAILED_ATTEMPTS,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(tooMany('Too many wrong PINs. Wait a few minutes and try again.'));
    },
  });
}

export const SCAN_MAX_PER_WINDOW = 30;
const SCAN_WINDOW_MS = 10 * 1000;

/**
 * Limits scans per device: far above what one person can scan (3 a second, sustained),
 * low enough that a stolen session cannot be used to hammer the API. Runs after requireGate.
 */
export function createScanLimiter(limit = SCAN_MAX_PER_WINDOW): RateLimitRequestHandler {
  return rateLimit({
    windowMs: SCAN_WINDOW_MS,
    limit,
    keyGenerator: (req) => `device:${req.gate?.deviceId ?? 'unknown'}`,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(tooMany('Scanning too fast. Wait a moment.'));
    },
  });
}

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
