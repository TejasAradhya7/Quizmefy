import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface JWTPayload {
  sub: string;        // userId
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

// ─── Token helpers ────────────────────────────────────────────────────────────

function signAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as jwt.SignOptions['expiresIn'],
  });
}

function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
}

function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { sub: string };
}

// ─── Auth service functions ───────────────────────────────────────────────────

export async function registerUser(input: RegisterInput) {
  const { email, password, displayName } = input;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw Object.assign(new Error('Email already registered'), { statusCode: 409 });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: { email, passwordHash, displayName },
    select: { id: true, email: true, displayName: true, role: true, createdAt: true },
  });

  logger.info('User registered', { userId: user.id, email: user.email });
  return user;
}

export async function loginUser(
  input: LoginInput,
  meta?: { userAgent?: string; ipAddress?: string }
): Promise<{ user: object; tokens: TokenPair }> {
  const { email, password } = input;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  const tokens = await createSession(user.id, user.email, user.role, meta);

  logger.info('User logged in', { userId: user.id });
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
    tokens,
  };
}

export async function refreshTokens(
  refreshToken: string,
  meta?: { userAgent?: string; ipAddress?: string }
): Promise<TokenPair> {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw Object.assign(new Error('Invalid or expired refresh token'), { statusCode: 401 });
  }

  const session = await prisma.session.findFirst({
    where: { refreshToken, isRevoked: false, expiresAt: { gt: new Date() } },
    include: { user: true },
  });

  if (!session || !session.user.isActive) {
    throw Object.assign(new Error('Session not found or revoked'), { statusCode: 401 });
  }

  // Revoke old session (refresh token rotation)
  await prisma.session.update({
    where: { id: session.id },
    data: { isRevoked: true },
  });

  const tokens = await createSession(
    session.userId,
    session.user.email,
    session.user.role,
    meta
  );

  logger.info('Tokens refreshed', { userId: payload.sub });
  return tokens;
}

export async function logoutUser(refreshToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { refreshToken },
    data: { isRevoked: true },
  });
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function createSession(
  userId: string,
  email: string,
  role: string,
  meta?: { userAgent?: string; ipAddress?: string }
): Promise<TokenPair> {
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  const days = parseInt(expiresIn.replace('d', ''), 10) || 7;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const refreshToken = signRefreshToken(userId);
  const accessToken = signAccessToken({ sub: userId, email, role });

  await prisma.session.create({
    data: {
      userId,
      refreshToken,
      expiresAt,
      userAgent: meta?.userAgent,
      ipAddress: meta?.ipAddress,
    },
  });

  return { accessToken, refreshToken, expiresIn: process.env.JWT_EXPIRES_IN || '15m' };
}
