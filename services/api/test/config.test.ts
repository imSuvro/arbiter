import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  SESSION_SECRET: 'test-session-secret-123456',
  ARBITER_OPERATOR_EMAIL: 'operator@arbiter.local',
  ARBITER_OPERATOR_PASSWORD: 'local-password-123',
};

describe('API configuration', () => {
  it('applies development defaults', () => {
    const config = loadConfig(base);
    expect(config.NODE_ENV).toBe('development');
    expect(config.API_PORT).toBe(4000);
    expect(config.QUEUE_BACKEND).toBe('memory');
    expect(config.SANDBOX_BACKEND).toBe('docker');
  });

  it('requires the production queue, database, and sandbox settings', () => {
    const production = loadConfig({
      ...base,
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://mongo:27017',
      QUEUE_BACKEND: 'sqs',
      QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123/arbiter',
      SANDBOX_BACKEND: 'docker',
    });
    expect(production.NODE_ENV).toBe('production');

    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      'MONGODB_URI is required',
    );
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://mongo:27017',
        QUEUE_BACKEND: 'memory',
      }),
    ).toThrow('QUEUE_BACKEND=sqs');
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://mongo:27017',
        QUEUE_BACKEND: 'sqs',
      }),
    ).toThrow('QUEUE_URL is required');
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        SESSION_SECRET: 'arbiter-local-session-secret-please-change',
        MONGODB_URI: 'mongodb://mongo:27017',
        QUEUE_BACKEND: 'sqs',
        QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123/arbiter',
        SANDBOX_BACKEND: 'docker',
      }),
    ).toThrow('SESSION_SECRET must be changed');
  });

  it('rejects malformed environment values', () => {
    expect(() => loadConfig({ ...base, ARBITER_OPERATOR_EMAIL: 'not-an-email' })).toThrow(
      'Invalid Arbiter configuration',
    );
  });
});
