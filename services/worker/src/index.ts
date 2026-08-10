import { createProviders, EvaluationEngine, getProvider } from '@arbiter/evaluator';
import { SqsQueue } from '@arbiter/queue';
import { FilesystemSandboxRunner } from '@arbiter/sandbox';
import { createStore } from '@arbiter/storage';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Worker configuration is missing ${name}.`);
  return value;
}

const region = process.env.AWS_REGION ?? 'ap-south-1';
const queueUrl = required('QUEUE_URL');
const store = await createStore({
  mongoUri: required('MONGODB_URI'),
  databaseName: process.env.MONGODB_DB_NAME ?? 'arbiter',
});
const providers = createProviders({
  googleApiKey: process.env.GOOGLE_GEMINI_API_KEY,
  googleModel: process.env.GOOGLE_GEMINI_MODEL,
});
const queue = new SqsQueue(queueUrl, region, process.env.SQS_ENDPOINT);
const engine = new EvaluationEngine(
  store,
  new FilesystemSandboxRunner({
    backend: process.env.SANDBOX_BACKEND === 'local' ? 'local' : 'docker',
    allowLocalBackend: process.env.NODE_ENV !== 'production',
  }),
);
const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;

const shutdown = async (): Promise<void> => {
  await queue.close();
  await store.close();
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

console.log(`Arbiter worker ${workerId} listening for evaluation requests.`);
await queue.start(async (runId) => {
  const run = await store.getRun(runId);
  if (!run) return;
  const provider = getProvider(providers, run.modelProfileId);
  if (!provider) {
    await store.updateRun(runId, {
      status: 'failed',
      error: `Model profile ${run.modelProfileId} is unavailable.`,
    });
    return;
  }
  await engine.process(runId, provider, workerId);
});
