import { sys } from '../kernel/syscalls.ts';
import { Signal, type Program, type WaitResult } from '../kernel/types.ts';

/**
 * Process 1.
 *
 * Seeds the filesystem, starts the boot target, and halts the kernel once that
 * target exits. Orphaned processes are re-parented here by the kernel, so init
 * also drains SIGCHLD rather than dying on it.
 */
export const init: Program = {
  name: 'init',
  description: 'process 1: seeds the system and starts the boot target',
  usage: 'init',
  *main(ctx) {
    yield sys.catchSignal(Signal.SIGCHLD);

    yield sys.writeFile('/etc/motd', MOTD);
    yield sys.writeFile('/etc/version', 'AIOS 0.1.0\n');
    yield sys.mkdir('/home/work');
    yield sys.writeFile('/home/README', README);

    const target = ctx.env.AIOS_INIT || 'sh';
    let argv: string[] = [target];
    if (ctx.env.AIOS_INIT_ARGV) {
      try {
        const parsed: unknown = JSON.parse(ctx.env.AIOS_INIT_ARGV);
        if (Array.isArray(parsed) && parsed.every((a) => typeof a === 'string')) {
          argv = parsed as string[];
        }
      } catch {
        yield sys.eprint('init: AIOS_INIT_ARGV is not valid JSON; using defaults');
      }
    }

    let status = 0;
    try {
      const pid: number = yield sys.spawn(target, { argv });
      const result: WaitResult = yield sys.wait(pid);
      status = result.code;
    } catch (err) {
      yield sys.eprint(`init: cannot start ${target}: ${(err as Error).message}`);
      status = 1;
    }

    // Boot target is gone; bring the system down.
    yield sys.writeFile('/var/log/shutdown', `exit ${status}\n`);
    yield sys.halt();
    return status;
  },
};

const MOTD = `AIOS 0.1.0

An operating system where AI agents are processes. Try:

  help                                  list every program
  ps                                    show the process table
  agent "explain the scheduler"         run one agent
  swarm --n 4 "name this project"       four agents, concurrently
  pipeline "draft a plan" "critique it" chain agents together
  cat /proc/sysinfo                     live kernel counters
`;

const README = `Your home directory.

Everything here lives in the kernel's virtual filesystem, not on the host disk.
/proc is synthetic: its contents are generated from live kernel state on every
read, so \`cat /proc/1/status\` always reflects what init is doing right now.
`;
