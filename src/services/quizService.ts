import { PrismaClient, Difficulty } from '@prisma/client';
import { generateContent } from './aiProvider';
import {
  generateCacheKey,
  cacheGet,
  cacheSet,
} from './cacheService';
import { buildQuizPrompt, buildSystemMessage } from '../utils/promptBuilder';
import { parseAIResponse, ParsedQuiz } from '../utils/responseParser';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateQuizInput {
  topic: string;
  difficulty?: Difficulty;
  numQuestions?: number;
  customInstructions?: string;
  userId?: string;
}

export interface QuizResult {
  quizId: string;
  requestId: string;
  cacheHit: boolean;
  latencyMs: number;
  quiz: ParsedQuiz;
}

// ─── Quiz generation service ──────────────────────────────────────────────────

export async function generateQuiz(input: GenerateQuizInput): Promise<QuizResult> {
  const {
    topic,
    difficulty = Difficulty.MEDIUM,
    numQuestions = 5,
    customInstructions,
    userId,
  } = input;

  const start = Date.now();

  // ── 1. Build cache key from prompt parameters ──────────────────────────────
  const cacheKey = generateCacheKey({
    topic: topic.toLowerCase().trim(),
    difficulty,
    numQuestions,
    customInstructions: customInstructions?.toLowerCase().trim() || '',
  });

  // ── 2. Check cache ─────────────────────────────────────────────────────────
  const cached = await cacheGet<{ quizId: string; requestId: string; quiz: ParsedQuiz }>(cacheKey);
  if (cached) {
    const latencyMs = Date.now() - start;
    logger.info('Quiz served from cache', { cacheKey, latencyMs });

    // Log the cache-hit request to DB (async, non-blocking)
    logQuizRequest({
      userId,
      topic,
      difficulty,
      numQuestions,
      cacheHit: true,
      latencyMs,
      quizId: cached.quizId,
      requestId: cached.requestId,
    }).catch((err) => logger.warn('Failed to log cache-hit request', { err }));

    return { ...cached, cacheHit: true, latencyMs };
  }

  // ── 3. Build prompt ────────────────────────────────────────────────────────
  const userPrompt = buildQuizPrompt({ topic, difficulty, numQuestions, customInstructions });
  const systemMessage = buildSystemMessage();

  // ── 4. Call AI provider ────────────────────────────────────────────────────
  logger.info('Generating quiz via AI', { topic, difficulty, numQuestions });
  const aiResult = await generateContent({ systemMessage, userPrompt });

  // ── 5. Parse and validate AI response ─────────────────────────────────────
  const parsedQuiz = parseAIResponse(aiResult.text);

  // ── 6. Persist to database ─────────────────────────────────────────────────
  const latencyMs = Date.now() - start;
  const { quizId, requestId } = await persistQuiz({
    userId,
    topic,
    difficulty,
    numQuestions,
    parsedQuiz,
    aiProvider: aiResult.provider,
    latencyMs,
    tokensUsed: aiResult.tokensUsed,
  });

  // ── 7. Cache the result ────────────────────────────────────────────────────
  await cacheSet(cacheKey, { quizId, requestId, quiz: parsedQuiz });

  return { quizId, requestId, cacheHit: false, latencyMs, quiz: parsedQuiz };
}

// ─── Get quiz by ID ───────────────────────────────────────────────────────────

export async function getQuizById(quizId: string) {
  // Check cache first
  const cacheKey = `quizmefy:quiz:${quizId}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) return cached;

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      questions: { orderBy: { questionNumber: 'asc' } },
      request: { select: { topic: true, difficulty: true, userId: true, createdAt: true } },
    },
  });

  if (quiz) {
    await cacheSet(cacheKey, quiz, 1800); // 30 min TTL for individual quizzes
  }

  return quiz;
}

// ─── Get quiz history ─────────────────────────────────────────────────────────

export async function getQuizHistory(
  userId: string,
  page = 1,
  limit = 10
) {
  const offset = (page - 1) * limit;

  const [quizzes, total] = await Promise.all([
    prisma.quiz.findMany({
      where: { request: { userId } },
      select: {
        id: true,
        title: true,
        topic: true,
        difficulty: true,
        createdAt: true,
        _count: { select: { questions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.quiz.count({ where: { request: { userId } } }),
  ]);

  return {
    quizzes,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function persistQuiz(params: {
  userId?: string;
  topic: string;
  difficulty: Difficulty;
  numQuestions: number;
  parsedQuiz: ParsedQuiz;
  aiProvider: string;
  latencyMs: number;
  tokensUsed: number;
}) {
  const { userId, topic, difficulty, numQuestions, parsedQuiz, aiProvider, latencyMs } = params;

  // Use Prisma transaction for atomic write
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.quizRequest.create({
      data: {
        userId: userId || null,
        prompt: `${topic} | ${difficulty} | ${numQuestions}q`,
        topic,
        difficulty,
        numQuestions,
        aiProvider,
        latencyMs,
        cacheHit: false,
      },
    });

    const quiz = await tx.quiz.create({
      data: {
        requestId: request.id,
        title: parsedQuiz.title,
        description: parsedQuiz.description || '',
        topic: parsedQuiz.topic,
        difficulty,
        metadata: { aiProvider, tokensUsed: params.tokensUsed },
        questions: {
          create: parsedQuiz.questions.map((q) => ({
            questionNumber: q.questionNumber,
            text: q.text,
            type: q.type,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation || '',
            difficulty,
          })),
        },
      },
    });

    return { quizId: quiz.id, requestId: request.id };
  });

  logger.info('Quiz persisted to DB', { quizId: result.quizId, requestId: result.requestId });
  return result;
}

async function logQuizRequest(params: {
  userId?: string;
  topic: string;
  difficulty: Difficulty;
  numQuestions: number;
  cacheHit: boolean;
  latencyMs: number;
  quizId: string;
  requestId: string;
}) {
  await prisma.quizRequest.create({
    data: {
      userId: params.userId || null,
      prompt: `${params.topic} | ${params.difficulty} | ${params.numQuestions}q`,
      topic: params.topic,
      difficulty: params.difficulty,
      numQuestions: params.numQuestions,
      cacheHit: params.cacheHit,
      latencyMs: params.latencyMs,
    },
  });
}
