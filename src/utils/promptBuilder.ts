import { Difficulty } from '@prisma/client';

interface PromptOptions {
  topic: string;
  difficulty: Difficulty;
  numQuestions: number;
  customInstructions?: string;
}

/**
 * Builds a structured, optimized prompt for AI quiz generation.
 * Outputs a strict JSON schema instruction to ensure parseable responses.
 */
export function buildQuizPrompt(options: PromptOptions): string {
  const { topic, difficulty, numQuestions, customInstructions } = options;

  const difficultyGuide: Record<Difficulty, string> = {
    EASY: 'basic recall and simple understanding',
    MEDIUM: 'application and analysis of concepts',
    HARD: 'synthesis, evaluation, and nuanced reasoning',
    EXPERT: 'expert-level domain knowledge, edge cases, and professional application',
  };

  return `You are an expert quiz creator and educator. Generate a high-quality quiz on the topic provided.

TOPIC: "${topic}"
DIFFICULTY: ${difficulty} (${difficultyGuide[difficulty]})
NUMBER OF QUESTIONS: ${numQuestions}
${customInstructions ? `ADDITIONAL INSTRUCTIONS: ${customInstructions}` : ''}

REQUIREMENTS:
- Questions must be accurate, clear, and unambiguous
- Each question must have exactly 4 options (A, B, C, D) unless it is TRUE_FALSE type
- Include a brief explanation for why the correct answer is correct
- Vary question types naturally (prefer MULTIPLE_CHOICE, use TRUE_FALSE sparingly)
- Questions should increase slightly in complexity across the quiz
- Do NOT repeat similar questions

You MUST respond with ONLY a valid JSON object matching this exact schema. No markdown, no code fences, no commentary — pure JSON only:

{
  "title": "string — concise, engaging quiz title",
  "description": "string — 1-2 sentence overview of what this quiz covers",
  "topic": "string — normalized topic name",
  "questions": [
    {
      "questionNumber": "number (1-based)",
      "text": "string — the question text",
      "type": "MULTIPLE_CHOICE | TRUE_FALSE",
      "options": [
        { "id": "A", "text": "string" },
        { "id": "B", "text": "string" },
        { "id": "C", "text": "string" },
        { "id": "D", "text": "string" }
      ],
      "correctAnswer": "string — the option id (A, B, C, or D)",
      "explanation": "string — why the correct answer is correct"
    }
  ]
}`;
}

/**
 * Builds a system message for chat-completion style APIs.
 */
export function buildSystemMessage(): string {
  return (
    'You are a world-class educational content creator specializing in quiz generation. ' +
    'You always respond with valid, well-structured JSON only — no markdown, no extra text. ' +
    'Your questions are clear, accurate, pedagogically sound, and appropriately challenging.'
  );
}
