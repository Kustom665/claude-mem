import { sys } from '../kernel/syscalls.ts';
import { ProcState, type Program, type ProcessInfo, type SyscallRequest, type WaitResult } from '../kernel/types.ts';
import { parse, expand, ParseError, type Job } from './parser.ts';

/**
 * The AIOS shell.
 *
 * `sh` is an ordinary process: it spends nearly all its life BLOCKED on a
 * `readline` syscall, which is exactly why the kernel stays alive during an
 * interactive session without any special case for "the shell".
 */

interface BackgroundJob {
  id: number;
  pid: number;
  command: string;
}

/** State threaded through a single shell session. */
interface Session {
  env: Record<string, string>;
  jobs: BackgroundJob[];
  nextJobId: number;
  lastStatus: number;
  pid: number;
}

export const sh: Program = {
  name: 'sh',
  description: 'interactive shell',
  usage: 'sh',
  *main(ctx) {
    const session: Session = {
      env: { ...ctx.env },
      jobs: [],
      nextJobId: 1,
      lastStatus: 0,
      pid: ctx.pid,
    };

    if (session.env.AIOS_QUIET !== '1') {
      yield sys.print(BANNER);
    }

    while (true) {
      const cwd: string = yield sys.cwd();
      const line: string | null = yield sys.readline(`${cwd} $ `);

      if (line === null) {
        yield sys.print('logout');
        return session.lastStatus;
      }

      yield* reapFinishedJobs(session);

      try {
        session.lastStatus = yield* runLine(line, session);
      } catch (err) {
        if (err instanceof ParseError) {
          yield sys.eprint(`sh: ${err.message}`);
          session.lastStatus = 2;
        } else {
          throw err;
        }
      }
    }
  },
};

const BANNER = [
  '',
  '   AIOS 0.1.0 — agents are processes',
  '   `help` lists programs, `ps` shows what is running, Ctrl-D logs out.',
  '',
].join('\n');

/** Execute one command line. Returns its exit status. */
function* runLine(line: string, session: Session): Generator<SyscallRequest, number, any> {
  const job = parse(line);
  if (!job) return session.lastStatus;

  // Expand variables in every token before dispatch.
  for (const stage of job.stages) {
    stage.argv = stage.argv.map((token) => expandToken(token, session));
    if (stage.redirect) {
      stage.redirect = { ...stage.redirect, path: expandToken(stage.redirect.path, session) };
    }
  }

  // A builtin only makes sense as a standalone command; it changes shell state,
  // which a spawned child could not do.
  const first = job.stages[0]!;
  if (job.stages.length === 1 && !job.background && BUILTINS.has(first.argv[0]!)) {
    return yield* runBuiltin(first.argv, session, first.redirect);
  }

  return yield* runPipeline(job, session);
}

function expandToken(token: string, session: Session): string {
  const withSpecials = token
    .replace(/\$\?/g, String(session.lastStatus))
    .replace(/\$\$/g, String(session.pid));
  return expand(withSpecials, (name) => session.env[name] ?? '');
}

/** Spawn each stage, threading stdout into the next stage's stdin. */
function* runPipeline(job: Job, session: Session): Generator<SyscallRequest, number, any> {
  if (job.background && job.stages.length > 1) {
    yield sys.eprint('sh: background pipelines are not supported; background a single command instead');
    return 2;
  }

  let carry = '';
  let status = 0;

  for (const [index, stage] of job.stages.entries()) {
    const isLast = index === job.stages.length - 1;
    const name = stage.argv[0]!;
    // Stream to the terminal only when the output is not being captured.
    const streamsToTty = isLast && !stage.redirect;

    let pid: number;
    try {
      pid = yield sys.spawn(name, {
        argv: stage.argv,
        stdin: carry,
        tty: streamsToTty,
      });
    } catch (err) {
      yield sys.eprint(`sh: ${(err as Error).message}`);
      return 127;
    }

    if (job.background) {
      const id = session.nextJobId++;
      session.jobs.push({ id, pid, command: stage.argv.join(' ') });
      yield sys.print(`[${id}] ${pid}`);
      return 0;
    }

    const result: WaitResult = yield sys.wait(pid);
    status = result.code;
    carry = result.stdout;

    // A failed stage stops the pipeline rather than feeding junk downstream.
    if (status !== 0 && !isLast) {
      yield sys.eprint(`sh: ${name} exited ${status}; pipeline aborted`);
      return status;
    }
  }

  const redirect = job.stages[job.stages.length - 1]!.redirect;
  if (redirect) {
    try {
      yield redirect.append
        ? sys.appendFile(redirect.path, carry)
        : sys.writeFile(redirect.path, carry);
    } catch (err) {
      yield sys.eprint(`sh: ${(err as Error).message}`);
      return 1;
    }
  }

  return status;
}

/** Wait on background jobs that have already exited, so they do not linger. */
function* reapFinishedJobs(session: Session): Generator<SyscallRequest, void, any> {
  if (session.jobs.length === 0) return;

  const procs: ProcessInfo[] = yield sys.ps();
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const remaining: BackgroundJob[] = [];

  for (const job of session.jobs) {
    const info = byPid.get(job.pid);
    if (info && info.state !== ProcState.ZOMBIE) {
      remaining.push(job);
      continue;
    }
    if (info) {
      // Zombie: wait() returns immediately and releases the PCB.
      const result: WaitResult = yield sys.wait(job.pid);
      yield sys.print(`[${job.id}] done (exit ${result.code})  ${job.command}`);
    }
  }
  session.jobs = remaining;
}

const BUILTINS = new Set(['cd', 'exit', 'export', 'env', 'jobs', 'clear', 'fg-status']);

function* runBuiltin(
  argv: string[],
  session: Session,
  redirect: { path: string; append: boolean } | undefined,
): Generator<SyscallRequest, number, any> {
  const [name, ...args] = argv;
  let output = '';
  let status = 0;

  switch (name) {
    case 'cd': {
      const target = args[0] ?? session.env.HOME ?? '/home';
      try {
        yield sys.chdir(target);
      } catch (err) {
        yield sys.eprint(`cd: ${(err as Error).message}`);
        status = 1;
      }
      break;
    }

    case 'exit': {
      const code = args[0] !== undefined ? Number(args[0]) : session.lastStatus;
      yield sys.exit(Number.isFinite(code) ? code : 0);
      break; // unreachable: exit does not return
    }

    case 'export': {
      if (args.length === 0) {
        output = Object.entries(session.env)
          .map(([k, v]) => `${k}=${v}`)
          .sort()
          .join('\n');
        break;
      }
      for (const assignment of args) {
        const eq = assignment.indexOf('=');
        if (eq <= 0) {
          yield sys.eprint(`export: invalid assignment: ${assignment}`);
          status = 2;
          continue;
        }
        const key = assignment.slice(0, eq);
        const value = assignment.slice(eq + 1);
        session.env[key] = value;
        // Mirror into the process env so spawned children inherit it.
        yield sys.setenv(key, value);
      }
      break;
    }

    case 'env':
      output = Object.entries(session.env)
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join('\n');
      break;

    case 'jobs':
      output =
        session.jobs.length === 0
          ? 'no background jobs'
          : session.jobs.map((j) => `[${j.id}] ${j.pid}  ${j.command}`).join('\n');
      break;

    case 'clear':
      output = '\x1b[2J\x1b[H';
      yield sys.write(1, output);
      return 0;

    default:
      yield sys.eprint(`sh: not a builtin: ${name}`);
      return 127;
  }

  if (output) {
    if (redirect) {
      try {
        yield redirect.append
          ? sys.appendFile(redirect.path, `${output}\n`)
          : sys.writeFile(redirect.path, `${output}\n`);
      } catch (err) {
        yield sys.eprint(`sh: ${(err as Error).message}`);
        return 1;
      }
    } else {
      yield sys.print(output);
    }
  }

  return status;
}
