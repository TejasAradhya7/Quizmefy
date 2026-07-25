import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { PrismaClient } from '@prisma/client';

import { logger, requestLogger } from './utils/logger';
import { initRedis } from './services/cacheService';
import { globalRateLimiter } from './middleware/rateLimiter';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

import authRouter from './routes/auth';
import quizRouter from './routes/quiz';
import healthRouter from './routes/health';

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();
const prisma = new PrismaClient();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Security middleware ──────────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  })
);

// ─── CORS & Body Parsing ──────────────────────────────────────────────────────

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ─── Request logging ──────────────────────────────────────────────────────────

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    requestLogger(req.method, req.path, res.statusCode, Date.now() - start, {
      ip: req.ip,
      userId: req.user?.sub,
    });
  });
  next();
});

app.set('trust proxy', 1);
app.use(globalRateLimiter);

// ─── Static Frontend Serving ──────────────────────────────────────────────────

// Serve static files from root frontend directory or dist/frontend
const frontendDir = path.resolve(__dirname, '../frontend');
const altFrontendDir = path.resolve(__dirname, './frontend');

app.use(express.static(frontendDir));
app.use(express.static(altFrontendDir));

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/quiz', quizRouter);

// ─── Root & SPA Fallback ──────────────────────────────────────────────────────

app.get(['/', '/index.html'], (_req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'), (err) => {
    if (err) {
      res.sendFile(path.join(altFrontendDir, 'index.html'), (err2) => {
        if (err2) {
          res.status(200).send('Quizmefy API is running');
        }
      });
    }
  });
});

// ─── 404 & Error handlers ─────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start() {
  try {
    // Connect to database
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Initialize Redis (non-blocking — falls back to NodeCache on failure)
    initRedis();

    // Start HTTP server
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Quizmefy API running on port ${PORT}`, {
        env: process.env.NODE_ENV,
        port: PORT,
      });
    });
  } catch (err) {
    logger.error('Failed to start server', { err });
    process.exit(1);
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info(`Received ${signal} — shutting down gracefully`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err });
  process.exit(1);
});

start();

export default app;
