import { sys } from '../kernel/syscalls.ts';
import { Signal, type Program, type WaitResult } from '../kernel/types.ts';

/**
 * Periodic task daemon.
 *
 * Demonstrates the daemon pattern: a long-lived process that sleeps, spawns
 * work, and shuts down cleanly on SIGTERM instead of being killed outright.
 */
export const cron: Program = {
  name: 'cron',
  description: 'run a program on an interval',
  usage: 'cron [--every <ms>] [--count <n> | --forever] <program> [args...]',
  *main(ctx) {
    const args = [...ctx.argv.slice(1)];

    let intervalMs = 1000;
    let count = 3;
    let forever = false;

    while (args[0]?.startsWith('--')) {
      const flag = args.shift()!;
      if (flag === '--forever') {
        forever = true;
        continue;
      }
      const value = args.shift();
      if (flag === '--every') intervalMs = Math.max(0, Number(value));
      else if (flag === '--count') count = Math.max(1, Number(value));
      else {
        yield sys.eprint(`cron: unknown option: ${flag}`);
        return 2;
      }
    }

    const [program, ...programArgs] = args;
    if (!program) {
      yield sys.eprint('usage: cron [--every <ms>] [--count <n> | --forever] <program> [args...]');
      return 2;
    }

    // Handle SIGTERM ourselves so an in-flight tick is not lost mid-write.
    yield sys.catchSignal(Signal.SIGTERM);
    yield sys.print(`cron: running "${program}" every ${intervalMs}ms${forever ? '' : ` x${count}`} (pid ${ctx.pid})`);

    for (let tick = 0; forever || tick < count; tick++) {
      if (tick > 0) yield sys.sleep(intervalMs);

      const signals: Signal[] = yield sys.signals();
      if (signals.includes(Signal.SIGTERM)) {
        yield sys.print(`cron: caught SIGTERM after ${tick} tick(s), shutting down`);
        return 0;
      }

      const pid: number = yield sys.spawn(program, {
        argv: [program, ...programArgs],
        tty: false,
      });
      const result: WaitResult = yield sys.wait(pid);
      const output = result.stdout.trim();
      yield sys.print(`cron[${tick + 1}] exit=${result.code}${output ? ` :: ${output.split('\n')[0]}` : ''}`);
    }

    return 0;
  },
};
