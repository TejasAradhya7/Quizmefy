import winston from 'winston';

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

const isProd = process.env.NODE_ENV === 'production';

// Pretty format for local dev
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
  })
);

// Structured JSON for production
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: isProd ? prodFormat : devFormat,
  defaultMeta: { service: 'quizmefy-api' },
  transports: [
    new winston.transports.Console(),
    ...(isProd
      ? [
          new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 10 * 1024 * 1024, // 10 MB
            maxFiles: 5,
          }),
          new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
          }),
        ]
      : []),
  ],
});

// Request logger helper
export const requestLogger = (
  method: string,
  path: string,
  statusCode: number,
  latencyMs: number,
  meta?: Record<string, unknown>
) => {
  logger.info('HTTP Request', { method, path, statusCode, latencyMs, ...meta });
};
