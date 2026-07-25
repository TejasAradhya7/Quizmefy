import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getCacheStats, redisAvailable } from '../services/cacheService';

const router = Router();
const prisma = new PrismaClient();

// ─── GET /health ──────────────────────────────────────────────────────────────
// Used by AWS ALB health checks, Docker HEALTHCHECK, and monitoring

router.get('/', async (_req: Request, res: Response) => {
  const start = Date.now();

  // Check DB connectivity
  let dbHealthy = false;
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbHealthy = true;
  } catch {
    dbHealthy = false;
  }

  const cacheStats = getCacheStats();
  const latencyMs = Date.now() - start;
  const overallHealthy = dbHealthy; // Cache fallback is fine

  res.status(overallHealthy ? 200 : 503).json({
    status: overallHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    latencyMs,
    services: {
      database: {
        status: dbHealthy ? 'healthy' : 'unhealthy',
        latencyMs: dbLatencyMs,
      },
      cache: {
        status: 'healthy',
        provider: cacheStats.provider,
        redisConnected: redisAvailable,
      },
    },
    version: process.env.npm_package_version || '1.0.0',
    env: process.env.NODE_ENV,
  });
});

export default router;
