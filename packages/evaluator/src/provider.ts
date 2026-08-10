import type { AgentTurnInput, AgentTurnOutput, ModelProfile, TaskSpec } from '@arbiter/contracts';
import { AgentTurnOutputSchema } from '@arbiter/contracts';

const GEMMA_REQUEST_TIMEOUT_MS = 30_000;
const GEMMA_MAX_OUTPUT_TOKENS = 2_048;
const GEMMA_MAX_ATTEMPTS = 2;
const GEMMA_CIRCUIT_FAILURE_LIMIT = 3;
const GEMMA_CIRCUIT_COOLDOWN_MS = 30_000;
const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface ModelProvider {
  profile: ModelProfile;
  runTurn(input: AgentTurnInput): Promise<AgentTurnOutput>;
}

const solution = [
  'export function normalizeWebhookEvent(event) {',
  "  if (!event || typeof event !== 'object') throw new Error('Webhook payload must be an object');",
  "  const source = String(event.source ?? event.provider ?? 'unknown').trim().toLowerCase();",
  "  const id = String(event.id ?? event.event_id ?? event.eventId ?? '').trim();",
  "  const type = String(event.type ?? event.event_type ?? 'unknown').trim().toLowerCase();",
  "  const receivedAt = String(event.receivedAt ?? event.received_at ?? event.timestamp ?? '').trim();",
  "  if (!id) throw new Error('Webhook payload must contain an event id');",
  "  if (!receivedAt) throw new Error('Webhook payload must contain a timestamp');",
  "  return { key: source + ':' + id, source, id, type, receivedAt };",
  '}',
  '',
  'export function acceptWebhookEvent(event, seenKeys = new Set()) {',
  '  const normalized = normalizeWebhookEvent(event);',
  '  if (seenKeys.has(normalized.key)) return { accepted: false, duplicate: true, event: normalized };',
  '  seenKeys.add(normalized.key);',
  '  return { accepted: true, duplicate: false, event: normalized };',
  '}',
].join('\n');

export class DeterministicProvider implements ModelProvider {
  public readonly profile: ModelProfile = {
    id: 'deterministic',
    label: 'Deterministic CI fixture',
    provider: 'arbiter',
    model: 'fixture-v1',
    available: true,
  };

  private readonly turns = new Map<string, number>();

  public async runTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
    const turn = this.turns.get(input.runId) ?? 0;
    this.turns.set(input.runId, turn + 1);
    if (input.task.slug === 'normalize-webhook-events' && turn === 0) {
      return {
        publicMessage: 'Implementing the event identity and duplicate guard.',
        action: { type: 'write_file', path: 'src/normalize.js', content: solution },
      };
    }
    if (turn === 1) {
      return {
        publicMessage: 'Running the task checks.',
        action: { type: 'run_command', command: 'npm test' },
      };
    }
    return {
      publicMessage: 'The workspace is ready for deterministic verification.',
      action: { type: 'finish', message: 'Finished implementation.' },
    };
  }
}

export class GoogleGemmaProvider implements ModelProvider {
  public readonly profile: ModelProfile;

  private consecutiveFailures = 0;

  private circuitOpenUntil = 0;

  public constructor(
    private readonly apiKey: string,
    model = 'gemma-4-31b-it',
  ) {
    this.profile = {
      id: 'google-gemma-4-31b',
      label: 'Google Gemma 4 31B',
      provider: 'google-ai-studio',
      model,
      available: true,
    };
  }

  public async runTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
    if (this.circuitOpenUntil > Date.now())
      throw new Error('Google provider circuit is open; retry later.');

    const prompt = buildPrompt(input);
    let response: Response | undefined;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < GEMMA_MAX_ATTEMPTS; attempt += 1) {
      try {
        response = await this.request(prompt);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Google provider request failed.');
        if (attempt === GEMMA_MAX_ATTEMPTS - 1) break;
        continue;
      }

      if (response.ok) {
        this.recordSuccess();
        break;
      }

      lastError = new Error(`Google provider returned HTTP ${response.status}.`);
      if (!TRANSIENT_HTTP_STATUSES.has(response.status) || attempt === GEMMA_MAX_ATTEMPTS - 1)
        break;
    }

    if (!response?.ok) {
      this.recordFailure();
      throw lastError ?? new Error('Google provider request failed.');
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) throw new Error('Google provider returned no candidate action.');
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return AgentTurnOutputSchema.parse(JSON.parse(cleaned));
  }

  private async request(prompt: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMMA_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.profile.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              maxOutputTokens: GEMMA_MAX_OUTPUT_TOKENS,
            },
          }),
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= GEMMA_CIRCUIT_FAILURE_LIMIT)
      this.circuitOpenUntil = Date.now() + GEMMA_CIRCUIT_COOLDOWN_MS;
  }
}

function buildPrompt(input: AgentTurnInput): string {
  return [
    'You are the coding agent inside Arbiter.',
    'Return only JSON matching {"action": {"type": ...}, "publicMessage": "..."}.',
    'Allowed action types: read_file(path), write_file(path,content), run_command(command), finish(message).',
    'Paths must be relative to the workspace. Never use absolute paths, parent traversal, or verifier paths.',
    `Task: ${input.task.title}\n${input.task.instructions}`,
    `Turn: ${input.turn}`,
    `Workspace files: ${input.workspaceTree.join(', ')}`,
    input.lastObservation
      ? `Last observation: ${input.lastObservation}`
      : 'No previous observation.',
  ].join('\n\n');
}

export function createProviders(options: {
  googleApiKey?: string;
  googleModel?: string;
}): ModelProvider[] {
  const providers: ModelProvider[] = [new DeterministicProvider()];
  if (options.googleApiKey)
    providers.push(new GoogleGemmaProvider(options.googleApiKey, options.googleModel));
  return providers;
}

export function getProvider(providers: ModelProvider[], profileId: string): ModelProvider | null {
  return providers.find((provider) => provider.profile.id === profileId) ?? null;
}

export function taskSummary(task: TaskSpec): string {
  return `${task.title}: ${task.summary}`;
}
