import { z } from 'zod';
import { logger } from './logger';

// ─── Zod schemas for expected AI output ──────────────────────────────────────

const OptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

const QuestionSchema = z.object({
  questionNumber: z.number().int().positive(),
  text: z.string().min(5),
  type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE']),
  options: z.array(OptionSchema).min(2).max(4),
  correctAnswer: z.string().min(1),
  explanation: z.string().optional().default(''),
});

const QuizSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional().default(''),
  topic: z.string().min(1),
  questions: z.array(QuestionSchema).min(1),
});

export type ParsedQuiz = z.infer<typeof QuizSchema>;
export type ParsedQuestion = z.infer<typeof QuestionSchema>;

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parses raw AI text output into a validated Quiz structure.
 * Handles markdown code fences, stray whitespace, and partial JSON.
 */
export function parseAIResponse(rawText: string): ParsedQuiz {
  // Strip markdown code fences if the AI wrapped the JSON
  let cleaned = rawText.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Extract first JSON object if there's surrounding text
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    logger.error('Failed to parse AI response as JSON', { raw: rawText.slice(0, 500), err });
    throw new Error('AI returned invalid JSON. Please retry.');
  }

  const result = QuizSchema.safeParse(parsed);
  if (!result.success) {
    logger.error('AI response failed schema validation', {
      errors: result.error.flatten(),
      raw: rawText.slice(0, 500),
    });
    throw new Error(`AI response did not match expected schema: ${result.error.message}`);
  }

  // Validate correctAnswer exists in options
  for (const q of result.data.questions) {
    const optionIds = q.options.map((o) => o.id);
    if (!optionIds.includes(q.correctAnswer)) {
      logger.warn('Question has invalid correctAnswer — attempting to fix', {
        questionNumber: q.questionNumber,
        correctAnswer: q.correctAnswer,
        optionIds,
      });
      // Auto-correct to first option if invalid
      q.correctAnswer = optionIds[0];
    }
  }

  return result.data;
}
