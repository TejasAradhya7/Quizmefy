// Jest test setup — load env vars for tests
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

// Set safe test defaults
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_chars_minimum_!!';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_32_chars_min_!';
process.env.OPENAI_API_KEYS = process.env.OPENAI_API_KEYS || 'sk-test-placeholder';
process.env.AI_PROVIDER = process.env.AI_PROVIDER || 'openai';
process.env.REDIS_URL = ''; // Use NodeCache in tests
process.env.CACHE_TTL_SECONDS = '60';
