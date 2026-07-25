import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger';

// ─── Global rate limiter ───────────────────────────────────────────────────────

export const globalRateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({ error: 'Too many requests, please slow down' });
  },
});

// ─── AI generation rate limiter ───────────────────────────────────────────────
// Stricter limit on expensive AI endpoints

export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: parseInt(process.env.AI_RATE_LIMIT_MAX || '20', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Key by user ID if authenticated, otherwise by IP
    return req.user?.sub || req.ip || 'anonymous';
  },
  handler: (req, res) => {
    logger.warn('AI rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.sub,
    });
    res.status(429).json({
      error: 'AI generation rate limit exceeded. Please wait before making another request.',
      retryAfter: 60,
    });
  },
});

// ─── Auth rate limiter ────────────────────────────────────────────────────────
// Strict limit on auth endpoints to prevent brute force

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later' },
});
