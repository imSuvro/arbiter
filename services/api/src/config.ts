import { z } from 'zod';

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: z.string().min(1).default('arbiter'),
  SESSION_SECRET: z.string().min(16),
  ARBITER_OPERATOR_EMAIL: z.string().email(),
  ARBITER_OPERATOR_PASSWORD: z.string().min(8),
  GOOGLE_GEMINI_API_KEY: z.string().optional(),
  GOOGLE_GEMINI_MODEL: z.string().default('gemma-4-26b-a4b-it'),
  QUEUE_BACKEND: z.enum(['memory', 'sqs']).default('memory'),
  QUEUE_URL: z.string().url().optional(),
  AWS_REGION: z.string().default('ap-south-1'),
  SQS_ENDPOINT: z.string().url().optional(),
  SANDBOX_BACKEND: z.enum(['docker', 'local']).default('docker'),
  MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(1),
});

export type ApiConfig = z.infer<typeof EnvironmentSchema> & { MONGODB_URI?: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = EnvironmentSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Arbiter configuration: ${problems}`);
  }
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.SESSION_SECRET === 'arbiter-local-session-secret-please-change'
  ) {
    throw new Error('SESSION_SECRET must be changed before production startup.');
  }
  if (result.data.NODE_ENV === 'production' && !result.data.MONGODB_URI) {
    throw new Error('MONGODB_URI is required for production startup.');
  }
  if (result.data.NODE_ENV === 'production' && result.data.QUEUE_BACKEND !== 'sqs') {
    throw new Error('QUEUE_BACKEND=sqs is required for production startup.');
  }
  if (result.data.NODE_ENV === 'production' && !result.data.QUEUE_URL) {
    throw new Error('QUEUE_URL is required for production startup.');
  }
  if (result.data.NODE_ENV === 'production' && result.data.SANDBOX_BACKEND !== 'docker') {
    throw new Error('SANDBOX_BACKEND=docker is required until the Fargate task bridge is enabled.');
  }
  return result.data;
}
