import { sys } from '../kernel/syscalls.ts';
import type { Program, WaitResult } from '../kernel/types.ts';
import type { ScoredEntry } from '../kernel/memory.ts';

/**
 * Agent programs.
 *
 * An agent is an ordinary process: it reads input, consults shared memory,
 * blocks on inference while the rest of the system keeps running, writes to
 * stdout, and exits with a status. Because it is just a process, it composes
 * with everything else — pipes, `wait`, signals, `ps`.
 */

/**
 * Flags that never take a value. Without this list a valueless flag would
 * swallow the task text as its argument (`agent --quiet "do the thing"` would
 * parse as quiet="do the thing" and leave no task at all).
 */
const BOOLEAN_FLAGS = new Set(['quiet', 'no-memory']);

/** Minimal flag parser: `--key value`, `--flag`, and positionals. */
function parseArgs(argv: readonly string[]): { flags: Map<string, string>; positional: string[] } {
  const flags = new Map<string, string>();
  const positional: string[] = [];

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags.set(key, 'true');
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, 'true');
    }
  }
  return { flags, positional };
}

export const agent: Program = {
  name: 'agent',
  description: 'run a task through the model, with shared memory as context',
  usage: 'agent [--role <role>] [--remember <key>] [--no-memory] [--quiet] <task...>',
  *main(ctx) {
    const { flags, positional } = parseArgs(ctx.argv);

    // Task comes from the command line, or from a pipe when it is omitted.
    const piped: string = yield sys.read();
    const task = [positional.join(' '), piped.trim()].filter(Boolean).join('\n\n');

    if (!task) {
      yield sys.eprint('usage: agent [--role <role>] <task...>');
      return 2;
    }

    const role = flags.get('role') ?? 'a careful analyst';
    const quiet = flags.has('quiet');
    const useMemory = !flags.has('no-memory');

    // Pull in what other agents have already established about this topic.
    let context = '';
    if (useMemory) {
      const recalled: ScoredEntry[] = yield sys.recall(task, 4);
      if (recalled.length > 0) {
        context =
          '\n\nRelevant prior findings from other agents:\n' +
          recalled.map((e) => `- ${e.key}: ${e.value}`).join('\n');
        if (!quiet) {
          yield sys.eprint(`[pid ${ctx.pid}] recalled ${recalled.length} prior finding(s)`);
        }
      }
    }

    let answer: string;
    try {
      // The process blocks here; the kernel keeps scheduling everyone else.
      answer = yield sys.infer(`${task}${context}`, {
        system: `You are ${role} running as process ${ctx.pid} inside AIOS. Be concise and concrete.`,
        maxTokens: Number(flags.get('max-tokens') ?? 1024),
      });
    } catch (err) {
      yield sys.eprint(`agent: inference failed: ${(err as Error).message}`);
      return 1;
    }

    yield sys.print(answer);

    // Publish the result so later agents can build on it.
    if (useMemory) {
      const key = flags.get('remember') ?? `agent-${ctx.pid}-${slug(task)}`;
      yield sys.remember(key, answer, ['agent-output', role.replace(/\s+/g, '-')]);
    }
    return 0;
  },
};

export const pipeline: Program = {
  name: 'pipeline',
  description: 'chain agents, feeding each stage the previous stage output',
  usage: 'pipeline "<stage 1>" "<stage 2>" [...]',
  *main(ctx) {
    const { flags, positional } = parseArgs(ctx.argv);
    if (positional.length === 0) {
      yield sys.eprint('usage: pipeline "<stage 1>" "<stage 2>" [...]');
      return 2;
    }

    const quiet = flags.has('quiet');
    let carry: string = ((yield sys.read()) as string).trim();

    for (const [index, stage] of positional.entries()) {
      if (!quiet) yield sys.eprint(`[pipeline] stage ${index + 1}/${positional.length}: ${stage}`);

      const argv = ['agent', '--quiet', stage];
      const pid: number = yield sys.spawn('agent', {
        argv,
        // Capture rather than stream, so the stage output can feed the next one.
        tty: false,
        stdin: carry,
      });

      const result: WaitResult = yield sys.wait(pid);
      if (result.code !== 0) {
        yield sys.eprint(`pipeline: stage ${index + 1} failed (exit ${result.code})`);
        if (result.stderr) yield sys.eprint(result.stderr.trim());
        return result.code;
      }
      carry = result.stdout.trim();
    }

    yield sys.print(carry);
    return 0;
  },
};

export const swarm: Program = {
  name: 'swarm',
  description: 'run one task across N agents concurrently and collect the answers',
  usage: 'swarm [--n <count>] [--role <role>] <task...>',
  *main(ctx) {
    const { flags, positional } = parseArgs(ctx.argv);
    const piped: string = yield sys.read();
    const task = [positional.join(' '), piped.trim()].filter(Boolean).join('\n\n');

    if (!task) {
      yield sys.eprint('usage: swarm [--n <count>] <task...>');
      return 2;
    }

    const count = Math.max(1, Math.min(32, Number(flags.get('n') ?? 3)));
    const role = flags.get('role');

    // Spawn every worker before waiting on any of them. They all block on
    // inference at once, which is the whole point of the scheduler.
    const pids: number[] = [];
    for (let i = 0; i < count; i++) {
      const argv = ['agent', '--quiet', '--no-memory'];
      if (role) argv.push('--role', `${role} (perspective ${i + 1})`);
      argv.push(task);

      const pid: number = yield sys.spawn('agent', { argv, tty: false, stdin: '' });
      pids.push(pid);
    }

    yield sys.eprint(`[swarm] ${count} agents running concurrently: ${pids.join(' ')}`);

    let failures = 0;
    for (const [index, pid] of pids.entries()) {
      const result: WaitResult = yield sys.wait(pid);
      if (result.code !== 0) {
        failures++;
        yield sys.print(`--- agent ${index + 1} (pid ${pid}) FAILED (exit ${result.code}) ---`);
        if (result.stderr) yield sys.print(result.stderr.trim());
        continue;
      }
      yield sys.print(`--- agent ${index + 1} (pid ${pid}) ---`);
      yield sys.print(result.stdout.trim());
    }

    return failures === pids.length ? 1 : 0;
  },
};

/** Short, filesystem-safe identifier derived from a task description. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'task';
}

export const agentPrograms = [agent, pipeline, swarm];
