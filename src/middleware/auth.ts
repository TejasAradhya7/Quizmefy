import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JWTPayload } from '../services/authService';
import { logger } from '../utils/logger';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * Strict auth middleware — rejects unauthenticated requests.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header missing or invalid' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err) {
    logger.debug('JWT verification failed', { err: (err as Error).message });
    res.status(401).json({ error: 'Invalid or expired access token' });
  }
}

/**
 * Optional auth middleware — populates req.user if token is valid,
 * but does NOT reject unauthenticated requests.
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      req.user = verifyAccessToken(token);
    } catch {
      // Invalid token — treat as unauthenticated, continue
    }
  }
  next();
}

/**
 * Admin-only middleware — must be used after requireAuth.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
