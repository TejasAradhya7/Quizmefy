import Redis from 'ioredis';
import NodeCache from 'node-cache';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';

// ─── Cache configuration ──────────────────────────────────────────────────────

const DEFAULT_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10);

// In-memory fallback (used when Redis is unavailable)
const memoryCache = new NodeCache({
  stdTTL: DEFAULT_TTL,
  checkperiod: 120,
  useClones: false,
  maxKeys: 1000,
});

// ─── Redis client ─────────────────────────────────────────────────────────────

let redisClient: Redis | null = null;
let redisAvailable = false;

export function initRedis(): void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn('REDIS_URL not set — using in-memory NodeCache fallback');
    return;
  }

  try {
    redisClient = new Redis(redisUrl, {
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.warn('Redis connection failed after 3 retries — switching to in-memory cache');
          redisAvailable = false;
          return null; // stop retrying
        }
        return Math.min(times * 500, 2000);
      },
      enableOfflineQueue: false,
      connectTimeout: 5000,
    });

    redisClient.on('connect', () => {
      redisAvailable = true;
      logger.info('✅ Redis connected');
    });

    redisClient.on('error', (err) => {
      redisAvailable = false;
      logger.warn('Redis error — falling back to in-memory cache', { err: err.message });
    });

    redisClient.connect().catch(() => {
      redisAvailable = false;
      logger.warn('Redis unavailable — using NodeCache fallback');
    });
  } catch (err) {
    logger.warn('Failed to initialize Redis', { err });
  }
}

// ─── Cache key generation ─────────────────────────────────────────────────────

/**
 * Generates a deterministic SHA-256 cache key from prompt parameters.
 * Ensures identical requests always hit the same cache entry.
 */
export function generateCacheKey(params: Record<string, unknown>): string {
  const normalized = JSON.stringify(params, Object.keys(params).sort());
  return `quizmefy:${createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`;
}

// ─── Cache operations ─────────────────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (redisAvailable && redisClient) {
      const val = await redisClient.get(key);
      if (val) {
        logger.debug('Cache HIT (Redis)', { key });
        return JSON.parse(val) as T;
      }
    } else {
      const val = memoryCache.get<T>(key);
      if (val !== undefined) {
        logger.debug('Cache HIT (Memory)', { key });
        return val;
      }
    }
  } catch (err) {
    logger.warn('Cache GET error', { key, err });
  }
  logger.debug('Cache MISS', { key });
  return null;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttl: number = DEFAULT_TTL
): Promise<void> {
  try {
    if (redisAvailable && redisClient) {
      await redisClient.setex(key, ttl, JSON.stringify(value));
      logger.debug('Cache SET (Redis)', { key, ttl });
    } else {
      memoryCache.set(key, value, ttl);
      logger.debug('Cache SET (Memory)', { key, ttl });
    }
  } catch (err) {
    logger.warn('Cache SET error', { key, err });
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    if (redisAvailable && redisClient) {
      await redisClient.del(key);
    } else {
      memoryCache.del(key);
    }
  } catch (err) {
    logger.warn('Cache DEL error', { key, err });
  }
}

export async function cacheFlushPattern(pattern: string): Promise<void> {
  try {
    if (redisAvailable && redisClient) {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
        logger.info(`Flushed ${keys.length} cache keys matching pattern`, { pattern });
      }
    }
    // NodeCache: flush all (no pattern support)
    else {
      memoryCache.flushAll();
    }
  } catch (err) {
    logger.warn('Cache flush error', { pattern, err });
  }
}

export function getCacheStats() {
  if (redisAvailable) {
    return { provider: 'redis', available: true };
  }
  return {
    provider: 'nodecache',
    available: true,
    stats: memoryCache.getStats(),
  };
}

export { redisAvailable };
