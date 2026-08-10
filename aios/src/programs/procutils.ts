import { sys } from '../kernel/syscalls.ts';
import { Signal, type Program, type ProcessInfo } from '../kernel/types.ts';

/** Process inspection and control. */

export const ps: Program = {
  name: 'ps',
  description: 'list running processes',
  usage: 'ps',
  *main() {
    const procs: ProcessInfo[] = yield sys.ps();
    yield sys.print(['  PID  PPID  STATE      PRI   CPU  COMMAND', ...procs.map(formatRow)].join('\n'));
    return 0;
  },
};

function formatRow(p: ProcessInfo): string {
  const cmd = p.argv.join(' ') || p.name;
  const suffix = p.waitReason ? ` (${p.waitReason})` : p.exitCode !== null ? ` (exit ${p.exitCode})` : '';
  return [
    String(p.pid).padStart(5),
    String(p.ppid).padStart(5),
    `  ${p.state.padEnd(9)}`,
    String(p.priority).padStart(3),
    String(p.cpuTime).padStart(6),
    `  ${cmd}${suffix}`,
  ].join('');
}

export const kill: Program = {
  name: 'kill',
  description: 'send a signal to a process',
  usage: 'kill [-SIGNAL] <pid>',
  *main(ctx) {
    const args = ctx.argv.slice(1);
    let signal = Signal.SIGTERM;

    const flag = args.find((a) => a.startsWith('-'));
    if (flag) {
      const name = flag.slice(1).toUpperCase();
      const resolved = name.startsWith('SIG') ? name : `SIG${name}`;
      if (!(resolved in Signal)) {
        yield sys.eprint(`kill: unknown signal: ${flag}`);
        return 2;
      }
      signal = Signal[resolved as keyof typeof Signal];
    }

    const pidArg = args.find((a) => !a.startsWith('-'));
    const pid = Number(pidArg);
    if (!pidArg || !Number.isInteger(pid)) {
      yield sys.eprint('usage: kill [-SIGNAL] <pid>');
      return 2;
    }

    try {
      yield sys.kill(pid, signal);
      return 0;
    } catch (err) {
      yield sys.eprint(`kill: ${(err as Error).message}`);
      return 1;
    }
  },
};

export const top: Program = {
  name: 'top',
  description: 'show kernel counters and the busiest processes',
  usage: 'top',
  *main() {
    const info: Record<string, unknown> = yield sys.sysinfo();
    const procs: ProcessInfo[] = yield sys.ps();
    const busiest = [...procs].sort((a, b) => b.cpuTime - a.cpuTime).slice(0, 10);

    yield sys.print(
      [
        `AIOS  up ${((info.uptimeMs as number) / 1000).toFixed(1)}s  ` +
          `procs ${info.processes}  runnable ${info.runnable}  ` +
          `switches ${info.contextSwitches}`,
        `memory ${info.memoryEntries} entries   inference backend: ${info.provider}`,
        '',
        '  PID  PPID  STATE      PRI   CPU  COMMAND',
        ...busiest.map(formatRow),
      ].join('\n'),
    );
    return 0;
  },
};

export const uname: Program = {
  name: 'uname',
  description: 'print system information',
  *main() {
    const info: Record<string, unknown> = yield sys.sysinfo();
    yield sys.print(`AIOS 0.1.0  agents-as-processes  backend=${info.provider}  programs=${info.programs}`);
    return 0;
  },
};

export const help: Program = {
  name: 'help',
  description: 'list available programs',
  usage: 'help [program]',
  *main(ctx) {
    const programs: Array<{ name: string; description: string; usage: string }> = yield sys.programs();
    const wanted = ctx.argv[1];

    if (wanted) {
      const match = programs.find((p) => p.name === wanted);
      if (!match) {
        yield sys.eprint(`help: no such program: ${wanted}`);
        return 1;
      }
      yield sys.print(`${match.name} — ${match.description}\nusage: ${match.usage}`);
      return 0;
    }

    const width = Math.max(...programs.map((p) => p.name.length));
    yield sys.print(
      [
        'AIOS programs (run `help <program>` for usage):',
        '',
        ...programs.map((p) => `  ${p.name.padEnd(width)}  ${p.description}`),
        '',
        'Shell builtins: cd, exit, jobs, export, env, clear, help',
      ].join('\n'),
    );
    return 0;
  },
};

export const procutils = [ps, kill, top, uname, help];
