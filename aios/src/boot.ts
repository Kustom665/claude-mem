import { Kernel } from './kernel/kernel.ts';
import { allPrograms } from './programs/index.ts';
import { createProvider, type LLMProvider } from './llm/provider.ts';
import type { ConsoleDevice } from './kernel/console.ts';

export interface BootOptions {
  console: ConsoleDevice;
  /** Defaults to the real API when ANTHROPIC_API_KEY is set, else the mock. */
  llm?: LLMProvider;
  /** Program init should start. Defaults to `sh`. */
  initTarget?: string;
  /** argv for the boot target. */
  initArgv?: string[];
  /** Extra environment for pid 1, inherited by everything it spawns. */
  env?: Record<string, string>;
  keepAlive?: boolean;
}

/** Build a kernel with every program installed, but nothing running yet. */
export function createSystem(opts: BootOptions): Kernel {
  const kernel = new Kernel({
    console: opts.console,
    llm: opts.llm ?? createProvider(),
    keepAlive: opts.keepAlive,
  });
  kernel.register(...allPrograms);
  return kernel;
}

/**
 * Boot the system and run until init halts it.
 * Resolves to the kernel so callers can inspect the final state.
 */
export async function boot(opts: BootOptions): Promise<Kernel> {
  const kernel = createSystem(opts);

  const env: Record<string, string> = {
    HOME: '/home',
    PATH: '/bin',
    USER: 'operator',
    ...opts.env,
  };
  if (opts.initTarget) env.AIOS_INIT = opts.initTarget;
  if (opts.initArgv) env.AIOS_INIT_ARGV = JSON.stringify(opts.initArgv);

  kernel.spawn('init', { argv: ['init'], env, cwd: '/home' });
  await kernel.boot();
  return kernel;
}
