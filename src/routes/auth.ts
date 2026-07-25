import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authRateLimiter } from '../middleware/rateLimiter';
import { requireAuth } from '../middleware/auth';
import {
  registerUser,
  loginUser,
  refreshTokens,
  logoutUser,
} from '../services/authService';

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  displayName: z.string().min(2).max(50).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── POST /auth/register ──────────────────────────────────────────────────────

router.post(
  '/register',
  authRateLimiter,
  validate(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await registerUser(req.body);
      res.status(201).json({ message: 'Registration successful', user });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /auth/login ─────────────────────────────────────────────────────────

router.post(
  '/login',
  authRateLimiter,
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await loginUser(req.body, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });
      res.json({ message: 'Login successful', ...result });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /auth/refresh ───────────────────────────────────────────────────────

router.post(
  '/refresh',
  validate(refreshSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tokens = await refreshTokens(req.body.refreshToken, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });
      res.json({ tokens });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /auth/logout ────────────────────────────────────────────────────────

router.post(
  '/logout',
  requireAuth,
  validate(refreshSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await logoutUser(req.body.refreshToken);
      res.json({ message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

export default router;
