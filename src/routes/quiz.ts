import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { aiRateLimiter } from '../middleware/rateLimiter';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { generateQuiz, getQuizById, getQuizHistory } from '../services/quizService';

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const generateSchema = z.object({
  topic: z
    .string()
    .min(2, 'Topic must be at least 2 characters')
    .max(200, 'Topic is too long'),
  difficulty: z
    .enum(['EASY', 'MEDIUM', 'HARD', 'EXPERT'])
    .optional()
    .default('MEDIUM'),
  numQuestions: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5),
  customInstructions: z.string().max(500).optional(),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

// ─── POST /quiz/generate ──────────────────────────────────────────────────────

router.post(
  '/generate',
  optionalAuth,           // Auth optional — guests can generate too
  aiRateLimiter,          // Strict AI cost rate limit
  validate(generateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await generateQuiz({
        ...req.body,
        userId: req.user?.sub,
      });

      res.status(200).json({
        success: true,
        cacheHit: result.cacheHit,
        latencyMs: result.latencyMs,
        quizId: result.quizId,
        requestId: result.requestId,
        quiz: result.quiz,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /quiz/:id ────────────────────────────────────────────────────────────

router.get(
  '/:id',
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const quiz = await getQuizById(req.params.id);
      if (!quiz) {
        res.status(404).json({ error: 'Quiz not found' });
        return;
      }
      res.json({ quiz });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /quiz/ — paginated history (auth required) ──────────────────────────

router.get(
  '/',
  requireAuth,
  validate(historyQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, limit } = req.query as unknown as { page: number; limit: number };
      const result = await getQuizHistory(req.user!.sub, page, limit);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
