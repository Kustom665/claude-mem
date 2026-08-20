import type { InferOptions } from '../kernel/syscalls.ts';

/**
 * Inference backend.
 *
 * The kernel only ever sees this interface, so the OS boots and runs
 * identically with or without network access — the mock provider stands in
 * when no API key is configured.
 */
export interface LLMProvider {
  readonly name: string;
  complete(prompt: string, opts: InferOptions): Promise<string>;
}

export const DEFAULT_MODEL = 'claude-sonnet-4-5';

/** Talks to the real Anthropic Messages API. */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel = DEFAULT_MODEL,
  ) {}

  async complete(prompt: string, opts: InferOptions): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model ?? this.defaultModel,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 1,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`inference failed: ${res.status} ${res.statusText} ${detail.slice(0, 400)}`);
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim();
  }
}

/**
 * Offline stand-in. Deterministic for a given prompt, so tests can assert on
 * its output and the OS stays fully usable with no credentials.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';

  constructor(private readonly latencyMs = 5) {}

  async complete(prompt: string, opts: InferOptions): Promise<string> {
    // A real call takes time, and the scheduler's ability to keep other
    // processes running during that time is the point — so simulate it.
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    const topic = summarize(prompt);
    const seed = hash(prompt + (opts.system ?? ''));
    const shape = SHAPES[seed % SHAPES.length]!;
    return shape(topic, seed);
  }
}

/** Pick the most substantive line of the prompt to echo back. */
function summarize(prompt: string): string {
  const line = prompt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] ?? prompt.trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line || '(empty prompt)';
}

/** Stable non-cryptographic hash (FNV-1a), for deterministic mock output. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Shape = (topic: string, seed: number) => string;

const SHAPES: Shape[] = [
  (topic) => `[mock] Considered "${topic}". Conclusion: proceed, with the caveat that the input was not independently verified.`,
  (topic, seed) => `[mock] Analysis of "${topic}":\n1. Primary factor (weight ${seed % 7}).\n2. Secondary factor.\n3. Recommendation: gather one more data point before committing.`,
  (topic) => `[mock] Summary: ${topic}\nRisk: low. Confidence: moderate. No blocking issues found.`,
  (topic, seed) => `[mock] Re "${topic}" — ${seed % 2 === 0 ? 'agree' : 'disagree'}. Reasoning omitted; this is a deterministic offline response.`,
];

/**
 * Choose a provider from the environment: the real API when a key is present,
 * the offline mock otherwise.
 */
export function createProvider(env: Record<string, string | undefined> = process.env): LLMProvider {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (key) return new AnthropicProvider(key, env.AIOS_MODEL?.trim() || DEFAULT_MODEL);
  return new MockProvider();
}
