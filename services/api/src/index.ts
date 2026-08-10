import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { EvaluationEngine, createProviders, getProvider } from '@arbiter/evaluator';
import { MemoryQueue, SqsQueue, type Queue } from '@arbiter/queue';
import { FilesystemSandboxRunner } from '@arbiter/sandbox';
import { createStore } from '@arbiter/storage';
import { ensureSeedData } from './seed.js';

loadDotenv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

const config = loadConfig();
const store = await createStore({
  mongoUri: config.MONGODB_URI,
  databaseName: config.MONGODB_DB_NAME,
});
await ensureSeedData(
  store,
  config.ARBITER_OPERATOR_EMAIL.toLowerCase(),
  config.ARBITER_OPERATOR_PASSWORD,
);
const providers = createProviders({
  googleApiKey: config.GOOGLE_GEMINI_API_KEY,
  googleModel: config.GOOGLE_GEMINI_MODEL,
});
const queue: Queue =
  config.QUEUE_BACKEND === 'sqs' && config.QUEUE_URL
    ? new SqsQueue(config.QUEUE_URL, config.AWS_REGION, config.SQS_ENDPOINT)
    : new MemoryQueue();
const engine = new EvaluationEngine(
  store,
  new FilesystemSandboxRunner({ backend: config.SANDBOX_BACKEND }),
);

if (queue instanceof MemoryQueue) {
  await queue.start(async (runId) => {
    const run = await store.getRun(runId);
    if (!run) return;
    const provider = getProvider(providers, run.modelProfileId);
    if (provider) await engine.process(runId, provider, 'api-embedded');
  });
}

const app = createApp({ store, queue, engine, providers, config });
const server = app.listen(config.API_PORT, () => {
  console.log(`Arbiter API listening on http://localhost:${config.API_PORT}`);
});

const shutdown = async (): Promise<void> => {
  server.close();
  await queue.close();
  await store.close();
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
