import { Kernel } from '../src/kernel/kernel.ts';
import { ScriptedConsole } from '../src/kernel/console.ts';
import { MockProvider, type LLMProvider } from '../src/llm/provider.ts';
import { allPrograms } from '../src/programs/index.ts';
import type { InferOptions } from '../src/kernel/syscalls.ts';
import type { Program } from '../src/kernel/types.ts';

/** Build a kernel with all stock programs plus any extras, ready to boot. */
export function makeKernel(
  opts: { input?: string[]; llm?: LLMProvider; programs?: Program[] } = {},
): { kernel: Kernel; console: ScriptedConsole } {
  const console_ = new ScriptedConsole(opts.input ?? []);
  const kernel = new Kernel({
    console: console_,
    llm: opts.llm ?? new MockProvider(0),
  });
  kernel.register(...allPrograms, ...(opts.programs ?? []));
  return { kernel, console: console_ };
}

/**
 * Provider that records how many inference calls are in flight at once.
 * Used to prove the scheduler really overlaps blocked agents.
 */
export class ConcurrencyProbeProvider implements LLMProvider {
  readonly name = 'probe';
  inFlight = 0;
  maxInFlight = 0;
  calls = 0;

  constructor(private readonly latencyMs = 20) {}

  async complete(_prompt: string, _opts: InferOptions): Promise<string> {
    this.calls++;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    this.inFlight--;
    return 'probe response';
  }
}

/** Provider that always fails, for testing error propagation into userland. */
export class FailingProvider implements LLMProvider {
  readonly name = 'failing';
  async complete(): Promise<string> {
    throw new Error('backend unavailable');
  }
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
