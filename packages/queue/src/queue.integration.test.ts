import { CreateQueueCommand, DeleteQueueCommand, SQSClient } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { SqsQueue } from './index.js';

const endpoint = process.env.SQS_ENDPOINT;
const shouldRun = Boolean(endpoint);

describe.skipIf(!shouldRun)('SqsQueue', () => {
  it('round-trips an evaluation request through LocalStack', async () => {
    const client = new SQSClient({ endpoint, region: process.env.AWS_REGION ?? 'us-east-1' });
    const created = await client.send(
      new CreateQueueCommand({ QueueName: `arbiter-test-${Date.now()}` }),
    );
    const actualQueueUrl = created.QueueUrl;
    expect(actualQueueUrl).toBeTruthy();
    const queue = new SqsQueue(
      actualQueueUrl ?? '',
      process.env.AWS_REGION ?? 'us-east-1',
      endpoint,
    );
    let resolveReceived!: (runId: string) => void;
    const received = new Promise<string>((resolve) => {
      resolveReceived = resolve;
    });
    const started = queue.start(async (runId) => resolveReceived(runId));
    await queue.enqueue('run-integration-1');
    await expect(received).resolves.toBe('run-integration-1');
    await queue.close();
    await started;
    await client.send(new DeleteQueueCommand({ QueueUrl: actualQueueUrl }));
    client.destroy();
  }, 30_000);
});
