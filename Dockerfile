# ─────────────────────────────────────────────────────────────
# Quizmefy — Multi-stage Dockerfile
# Stage 1: Build (TypeScript → JavaScript + Prisma engines)
# Stage 2: Production (minimal Node.js + compiled output)
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Builder ──────────────────────────────────────────
FROM node:20-alpine AS builder

# Install OpenSSL (required by Prisma on Alpine)
RUN apk add --no-cache openssl

WORKDIR /app

# Copy dependency manifests first (better layer caching)
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
COPY prisma ./prisma/

# Install ALL deps (including devDependencies for build)
RUN npm ci --frozen-lockfile

# Generate Prisma client + download engines (as root, so no permission issues)
RUN npx prisma generate

# Copy source
COPY src ./src

# Compile TypeScript
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────
FROM node:20-alpine AS production

# Install OpenSSL (required by Prisma at runtime on Alpine)
RUN apk add --no-cache openssl

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 quizmefy

WORKDIR /app

# Copy only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --frozen-lockfile --omit=dev && \
    npm cache clean --force

# Copy compiled JS from builder
COPY --from=builder /app/dist ./dist

# Copy Prisma schema and the fully generated client + engines from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY prisma ./prisma
COPY frontend ./frontend
COPY frontend ./dist/frontend

# Create logs directory
RUN mkdir -p logs

# Fix permissions — give quizmefy user ownership of everything
RUN chown -R quizmefy:nodejs /app

# Switch to non-root user
USER quizmefy

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Sync database schema then start server
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/index.js"]
