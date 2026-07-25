import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';

// ─── Key rotation helper ──────────────────────────────────────────────────────

class KeyRotator {
  private keys: string[];
  private currentIndex = 0;

  constructor(keyString: string) {
    this.keys = keyString
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    if (this.keys.length === 0) {
      throw new Error('No API keys provided');
    }
  }

  next(): string {
    const key = this.keys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return key;
  }

  get count(): number {
    return this.keys.length;
  }
}

// ─── AI Provider types ────────────────────────────────────────────────────────

export type AIProvider = 'openai' | 'anthropic' | 'mock';

export interface GenerationRequest {
  systemMessage: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface GenerationResult {
  text: string;
  provider: AIProvider;
  model: string;
  tokensUsed: number;
  latencyMs: number;
}

// ─── Retry helper with exponential backoff ───────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const isRateLimit =
        (err as { status?: number })?.status === 429 ||
        (err as { error?: { type?: string } })?.error?.type === 'rate_limit_error';

      if (attempt === maxAttempts) break;

      const delay = isRateLimit
        ? baseDelayMs * Math.pow(2, attempt) + Math.random() * 500
        : baseDelayMs * attempt;

      logger.warn(`AI call failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`, {
        err: (err as Error)?.message,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── OpenAI provider ─────────────────────────────────────────────────────────

let openaiRotator: KeyRotator | null = null;

function getOpenAIClient(): { client: OpenAI; key: string } {
  if (!openaiRotator) {
    const keys = process.env.OPENAI_API_KEYS;
    if (!keys) throw new Error('OPENAI_API_KEYS environment variable not set');
    openaiRotator = new KeyRotator(keys);
  }
  const key = openaiRotator.next();
  return { client: new OpenAI({ apiKey: key }), key };
}

async function generateWithOpenAI(req: GenerationRequest): Promise<GenerationResult> {
  const { client } = getOpenAIClient();
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const maxTokens = req.maxTokens || parseInt(process.env.OPENAI_MAX_TOKENS || '2048', 10);

  const start = Date.now();
  const response = await withRetry(() =>
    client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: req.systemMessage },
        { role: 'user', content: req.userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    })
  );

  const text = response.choices[0]?.message?.content || '';
  const tokensUsed = response.usage?.total_tokens || 0;

  logger.info('OpenAI generation complete', { model, tokensUsed, latencyMs: Date.now() - start });

  return {
    text,
    provider: 'openai',
    model,
    tokensUsed,
    latencyMs: Date.now() - start,
  };
}

// ─── Anthropic provider ───────────────────────────────────────────────────────

let anthropicRotator: KeyRotator | null = null;

function getAnthropicClient(): { client: Anthropic; key: string } {
  if (!anthropicRotator) {
    const keys = process.env.ANTHROPIC_API_KEYS;
    if (!keys) throw new Error('ANTHROPIC_API_KEYS environment variable not set');
    anthropicRotator = new KeyRotator(keys);
  }
  const key = anthropicRotator.next();
  return { client: new Anthropic({ apiKey: key }), key };
}

async function generateWithAnthropic(req: GenerationRequest): Promise<GenerationResult> {
  const { client } = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
  const maxTokens = req.maxTokens || parseInt(process.env.ANTHROPIC_MAX_TOKENS || '2048', 10);

  const start = Date.now();
  const response = await withRetry(() =>
    client.messages.create({
      model,
      max_tokens: maxTokens,
      system: req.systemMessage,
      messages: [{ role: 'user', content: req.userPrompt }],
    })
  );

  const text =
    response.content[0]?.type === 'text' ? response.content[0].text : '';
  const tokensUsed =
    (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

  logger.info('Anthropic generation complete', { model, tokensUsed, latencyMs: Date.now() - start });

  return {
    text,
    provider: 'anthropic',
    model,
    tokensUsed,
    latencyMs: Date.now() - start,
  };
}

// ─── Mock Quiz Generator Fallback ─────────────────────────────────────────────

function generateMockResponse(prompt: string): string {
  // Extract topic from prompt if possible
  const topicMatch = prompt.match(/TOPIC:\s*"([^"]+)"/i);
  const rawTopic = topicMatch ? topicMatch[1] : 'General Knowledge';
  const topic = rawTopic.trim();

  return JSON.stringify({
    title: `${topic} Master Quiz`,
    description: `A comprehensive quiz covering key concepts, principles, and practical questions about ${topic}.`,
    topic: topic,
    questions: [
      {
        questionNumber: 1,
        text: `What is the core fundamental principle of ${topic}?`,
        type: 'MULTIPLE_CHOICE',
        options: [
          { id: 'A', text: `Systematic application of core ${topic} fundamentals` },
          { id: 'B', text: `Random execution without structured analysis` },
          { id: 'C', text: `Deprecated legacy techniques from earlier decades` },
          { id: 'D', text: `Unrelated auxiliary processes` }
        ],
        correctAnswer: 'A',
        explanation: `In ${topic}, structured application of fundamentals ensures accuracy and optimal efficiency.`
      },
      {
        questionNumber: 2,
        text: `Which of the following best describes a key benefit of mastering ${topic}?`,
        type: 'MULTIPLE_CHOICE',
        options: [
          { id: 'A', text: `Increased error rates and performance bottlenecks` },
          { id: 'B', text: `Higher reliability, performance, and scalability` },
          { id: 'C', text: `Complete redundancy of modern tooling` },
          { id: 'D', text: `No measurable impact on outcomes` }
        ],
        correctAnswer: 'B',
        explanation: `Mastering ${topic} allows practitioners to achieve higher reliability and efficiency.`
      },
      {
        questionNumber: 3,
        text: `True or False: Advanced ${topic} practices require continuous evaluation and adherence to best practices.`,
        type: 'TRUE_FALSE',
        options: [
          { id: 'A', text: 'True' },
          { id: 'B', text: 'False' }
        ],
        correctAnswer: 'A',
        explanation: `Continuous evaluation and best practices are essential for success in ${topic}.`
      },
      {
        questionNumber: 4,
        text: `When troubleshooting complex issues in ${topic}, what is the recommended initial step?`,
        type: 'MULTIPLE_CHOICE',
        options: [
          { id: 'A', text: `Inspect structured logs, stack traces, and system metrics` },
          { id: 'B', text: `Ignore error messages and restart randomly` },
          { id: 'C', text: `Delete configuration files without backup` },
          { id: 'D', text: `Assume third-party components are flawless` }
        ],
        correctAnswer: 'A',
        explanation: `Log analysis and empirical investigation are the foundation of effective troubleshooting.`
      },
      {
        questionNumber: 5,
        text: `What is considered a modern industry standard when deploying ${topic} solutions?`,
        type: 'MULTIPLE_CHOICE',
        options: [
          { id: 'A', text: `Automated CI/CD pipelines with comprehensive testing` },
          { id: 'B', text: `Manual file transfer via unencrypted FTP` },
          { id: 'C', text: `Skipping validation in production environments` },
          { id: 'D', text: `Relying exclusively on single-point failure nodes` }
        ],
        correctAnswer: 'A',
        explanation: `Automated CI/CD pipelines ensure safe, reproducible, and rapid deployments.`
      }
    ]
  });
}

// ─── Unified AI provider interface ───────────────────────────────────────────

/**
 * Calls the configured AI provider with automatic retry and key rotation.
 * Falls back to mock provider if quota is exceeded and fallback is enabled.
 */
export async function generateContent(req: GenerationRequest): Promise<GenerationResult> {
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase() as AIProvider;

  logger.debug('Calling AI provider', { provider });

  if (provider === 'mock') {
    const start = Date.now();
    return {
      text: generateMockResponse(req.userPrompt),
      provider: 'mock',
      model: 'mock-simulator',
      tokensUsed: 150,
      latencyMs: Date.now() - start,
    };
  }

  try {
    if (provider === 'anthropic') {
      return await generateWithAnthropic(req);
    }
    return await generateWithOpenAI(req);
  } catch (err: unknown) {
    const errMessage = (err as Error)?.message || '';
    const isQuotaError = errMessage.includes('quota') || errMessage.includes('429') || errMessage.includes('exceeded');

    // Auto fallback to mock provider if quota exceeded or configured to allow fallback
    if (isQuotaError && process.env.ALLOW_MOCK_FALLBACK !== 'false') {
      logger.warn('AI provider quota exceeded — using Mock Provider fallback', { provider, err: errMessage });
      const start = Date.now();
      return {
        text: generateMockResponse(req.userPrompt),
        provider: 'mock',
        model: 'mock-fallback',
        tokensUsed: 0,
        latencyMs: Date.now() - start,
      };
    }

    throw err;
  }
}
