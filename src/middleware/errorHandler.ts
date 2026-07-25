import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Custom error type that routes can throw
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

interface ExtendedError extends Error {
  statusCode?: number;
  code?: string;
  status?: number;
}

/**
 * Centralized error handler middleware.
 * Must be registered LAST in Express middleware chain.
 */
export function errorHandler(
  err: ExtendedError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  // Log all errors
  if (statusCode >= 500) {
    logger.error('Unhandled server error', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      userId: req.user?.sub,
    });
  } else {
    logger.warn('Client error', {
      message: err.message,
      statusCode,
      path: req.path,
      method: req.method,
    });
  }

  // Prisma-specific errors
  if (err.code === 'P2002') {
    res.status(409).json({
      error: 'Resource already exists',
      ...(isProd ? {} : { detail: err.message }),
    });
    return;
  }

  if (err.code === 'P2025') {
    res.status(404).json({ error: 'Resource not found' });
    return;
  }

  // Generic response
  res.status(statusCode).json({
    error: statusCode < 500 ? err.message : 'Internal server error',
    ...(isProd ? {} : { stack: err.stack }),
  });
}

/**
 * 404 handler for unmatched routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
  });
}
