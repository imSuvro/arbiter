import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

export type QueueHandler = (runId: string) => Promise<void>;

export interface Queue {
  enqueue(runId: string): Promise<void>;
  start(handler: QueueHandler): Promise<void>;
  close(): Promise<void>;
}

export class MemoryQueue implements Queue {
  private readonly pending: string[] = [];
  private handler: QueueHandler | null = null;
  private closed = false;
  private processing = false;

  public async enqueue(runId: string): Promise<void> {
    this.pending.push(runId);
    await this.pump();
  }

  public async start(handler: QueueHandler): Promise<void> {
    this.handler = handler;
    await this.pump();
  }

  public async close(): Promise<void> {
    this.closed = true;
  }

  private async pump(): Promise<void> {
    if (this.processing || !this.handler || this.closed) return;
    this.processing = true;
    try {
      while (!this.closed && this.pending.length > 0) {
        const runId = this.pending.shift();
        if (runId) await this.handler(runId);
      }
    } finally {
      this.processing = false;
    }
  }
}

export class SqsQueue implements Queue {
  private closed = false;
  private started = false;
  private readonly client: SQSClient;

  public constructor(
    private readonly queueUrl: string,
    region: string,
    endpoint?: string,
  ) {
    this.client = new SQSClient({ region, ...(endpoint ? { endpoint } : {}) });
  }

  public async enqueue(runId: string): Promise<void> {
    await this.client.send(
      new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify({ runId }) }),
    );
  }

  public async start(handler: QueueHandler): Promise<void> {
    this.started = true;
    try {
      while (!this.closed) {
        let response;
        try {
          response = await this.client.send(
            new ReceiveMessageCommand({
              QueueUrl: this.queueUrl,
              MaxNumberOfMessages: 5,
              WaitTimeSeconds: 10,
              VisibilityTimeout: 900,
            }),
          );
        } catch (error) {
          if (this.closed) return;
          throw error;
        }
        for (const message of response.Messages ?? []) {
          if (!message.ReceiptHandle || !message.Body) continue;
          const payload = JSON.parse(message.Body) as { runId?: string };
          if (payload.runId) await handler(payload.runId);
          await this.client.send(
            new DeleteMessageCommand({
              QueueUrl: this.queueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }),
          );
        }
      }
    } finally {
      this.client.destroy();
    }
  }

  public async close(): Promise<void> {
    this.closed = true;
    if (!this.started) this.client.destroy();
  }
}
