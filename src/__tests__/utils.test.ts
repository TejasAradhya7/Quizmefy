import { parseAIResponse } from '../utils/responseParser';
import { generateCacheKey } from '../services/cacheService';
import { buildQuizPrompt, buildSystemMessage } from '../utils/promptBuilder';

// ─── responseParser tests ─────────────────────────────────────────────

describe('parseAIResponse', () => {
  const validQuizJSON = {
    title: 'JavaScript Fundamentals Quiz',
    description: 'Test your JavaScript knowledge',
    topic: 'JavaScript',
    questions: [
      {
        questionNumber: 1,
        text: 'What does `typeof null` return in JavaScript?',
        type: 'MULTIPLE_CHOICE',
        options: [
          { id: 'A', text: 'null' },
          { id: 'B', text: 'object' },
          { id: 'C', text: 'undefined' },
          { id: 'D', text: 'string' },
        ],
        correctAnswer: 'B',
        explanation: 'This is a known quirk in JavaScript.',
      },
    ],
  };

  it('parses valid JSON string', () => {
    const result = parseAIResponse(JSON.stringify(validQuizJSON));
    expect(result.title).toBe('JavaScript Fundamentals Quiz');
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].correctAnswer).toBe('B');
  });

  it('strips markdown code fences', () => {
    const wrapped = `\`\`\`json\n${JSON.stringify(validQuizJSON)}\n\`\`\``;
    const result = parseAIResponse(wrapped);
    expect(result.title).toBe('JavaScript Fundamentals Quiz');
  });

  it('extracts JSON from surrounding text', () => {
    const surrounded = `Here is your quiz: ${JSON.stringify(validQuizJSON)} Hope you enjoy!`;
    const result = parseAIResponse(surrounded);
    expect(result.questions).toHaveLength(1);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAIResponse('not valid json at all')).toThrow();
  });

  it('throws when schema validation fails (missing title)', () => {
    const invalid = { ...validQuizJSON, title: '' };
    expect(() => parseAIResponse(JSON.stringify(invalid))).toThrow();
  });

  it('auto-corrects invalid correctAnswer', () => {
    const quiz = {
      ...validQuizJSON,
      questions: [
        {
          ...validQuizJSON.questions[0],
          correctAnswer: 'Z', // invalid
        },
      ],
    };
    const result = parseAIResponse(JSON.stringify(quiz));
    // Should be auto-corrected to first option id 'A'
    expect(result.questions[0].correctAnswer).toBe('A');
  });
});

// ─── cacheService tests ───────────────────────────────────────────────

describe('generateCacheKey', () => {
  it('generates a consistent key for same params', () => {
    const params = { topic: 'python', difficulty: 'MEDIUM', numQuestions: 5 };
    const key1 = generateCacheKey(params);
    const key2 = generateCacheKey(params);
    expect(key1).toBe(key2);
  });

  it('generates different keys for different params', () => {
    const key1 = generateCacheKey({ topic: 'python', difficulty: 'MEDIUM' });
    const key2 = generateCacheKey({ topic: 'javascript', difficulty: 'MEDIUM' });
    expect(key1).not.toBe(key2);
  });

  it('is order-independent (sorted keys)', () => {
    const key1 = generateCacheKey({ a: '1', b: '2' });
    const key2 = generateCacheKey({ b: '2', a: '1' });
    expect(key1).toBe(key2);
  });

  it('starts with quizmefy: prefix', () => {
    const key = generateCacheKey({ topic: 'test' });
    expect(key.startsWith('quizmefy:')).toBe(true);
  });
});

// ─── promptBuilder tests ──────────────────────────────────────────────

describe('buildQuizPrompt', () => {
  it('includes topic in the prompt', () => {
    const prompt = buildQuizPrompt({ topic: 'Quantum Physics', difficulty: 'HARD', numQuestions: 5 });
    expect(prompt).toContain('Quantum Physics');
  });

  it('includes difficulty', () => {
    const prompt = buildQuizPrompt({ topic: 'Test', difficulty: 'EXPERT', numQuestions: 3 });
    expect(prompt).toContain('EXPERT');
  });

  it('includes number of questions', () => {
    const prompt = buildQuizPrompt({ topic: 'Test', difficulty: 'EASY', numQuestions: 10 });
    expect(prompt).toContain('10');
  });

  it('includes custom instructions when provided', () => {
    const prompt = buildQuizPrompt({
      topic: 'Test', difficulty: 'MEDIUM', numQuestions: 5,
      customInstructions: 'Focus on edge cases',
    });
    expect(prompt).toContain('Focus on edge cases');
  });

  it('does not include custom instructions section when not provided', () => {
    const prompt = buildQuizPrompt({ topic: 'Test', difficulty: 'MEDIUM', numQuestions: 5 });
    expect(prompt).not.toContain('ADDITIONAL INSTRUCTIONS');
  });
});

describe('buildSystemMessage', () => {
  it('returns a non-empty string', () => {
    const msg = buildSystemMessage();
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('mentions JSON in the system message', () => {
    const msg = buildSystemMessage();
    expect(msg.toLowerCase()).toContain('json');
  });
});
