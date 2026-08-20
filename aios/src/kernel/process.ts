import { ProcState, PRIORITY, type Message, type Priority, type ProcessContext, type ProcessInfo, type ProgramGenerator, type Program } from './types.ts';
import { Signal } from './types.ts';

/**
 * Process Control Block.
 *
 * Holds everything the kernel knows about a process: its generator (the
 * suspended execution state), its I/O buffers, its mailbox, and its accounting.
 */
export class Process {
  readonly pid: number;
  /** Mutable: orphans are re-parented to init when their parent dies. */
  ppid: number;
  readonly name: string;
  readonly argv: readonly string[];
  readonly startedAt = Date.now();

  env: Record<string, string>;
  cwd: string;
  priority: Priority;
  state: ProcState = ProcState.NEW;
  exitCode: number | null = null;

  /** Suspended execution state. Created lazily on first schedule. */
  gen: ProgramGenerator | null = null;
  readonly program: Program;

  /** Value handed to `gen.next()` when the process resumes. */
  resumeValue: unknown = undefined;
  /** Error thrown into the generator when it resumes, if any. */
  resumeError: Error | null = null;

  stdin = '';
  stdout = '';
  stderr = '';

  /** Undelivered IPC messages. */
  readonly mailbox: Message[] = [];

  /** Child pids, used for reaping and for `wait`. */
  readonly children = new Set<number>();

  /** Signals raised but not yet observed by the process. */
  readonly pendingSignals: Signal[] = [];
  /** Signals the process has asked to handle rather than die on. */
  readonly caughtSignals = new Set<Signal>();

  /** Syscalls executed. Our stand-in for CPU time on a virtual CPU. */
  cpuTime = 0;
  /** Scheduler passes survived without running. Drives aging. */
  waitTicks = 0;
  /** Why the process is blocked, for `ps` and /proc. */
  waitReason: string | null = null;

  /** Resolved when the process exits, so `wait` and the shell can join on it. */
  readonly exited: Promise<number>;
  private resolveExited!: (code: number) => void;

  /** True once detached; `init` reaps it instead of the parent. */
  detached = false;

  /** When true, stdout streams to the console as well as into the buffer. */
  tty = true;

  constructor(opts: {
    pid: number;
    ppid: number;
    program: Program;
    argv: readonly string[];
    env: Record<string, string>;
    cwd: string;
    priority?: Priority;
  }) {
    this.pid = opts.pid;
    this.ppid = opts.ppid;
    this.program = opts.program;
    this.name = opts.program.name;
    this.argv = opts.argv;
    this.env = opts.env;
    this.cwd = opts.cwd;
    this.priority = opts.priority ?? PRIORITY.NORMAL;
    this.exited = new Promise<number>((resolve) => {
      this.resolveExited = resolve;
    });
  }

  /** Read-only view passed to the program as `ctx`. */
  context(): ProcessContext {
    return {
      pid: this.pid,
      ppid: this.ppid,
      argv: this.argv,
      env: { ...this.env },
      cwd: this.cwd,
    };
  }

  /**
   * Effective scheduling priority, lowered (i.e. made more urgent) the longer
   * the process has been passed over. Without aging, a busy stream of
   * high-priority work would starve everything below it indefinitely.
   */
  effectivePriority(): number {
    return this.priority - Math.floor(this.waitTicks / AGING_INTERVAL);
  }

  /** Mark exited and wake anything joined on {@link exited}. */
  terminate(code: number): void {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.state = ProcState.ZOMBIE;
    this.waitReason = null;
    this.resolveExited(code);
  }

  info(): ProcessInfo {
    return {
      pid: this.pid,
      ppid: this.ppid,
      name: this.name,
      state: this.state,
      priority: this.priority,
      cpuTime: this.cpuTime,
      startedAt: this.startedAt,
      exitCode: this.exitCode,
      argv: this.argv,
      waitReason: this.waitReason,
    };
  }

  /** Content of /proc/<pid>/status. */
  procStatus(): string {
    const lines = [
      `Name:\t${this.name}`,
      `Pid:\t${this.pid}`,
      `PPid:\t${this.ppid}`,
      `State:\t${this.state}`,
      `Priority:\t${this.priority}`,
      `CpuTime:\t${this.cpuTime}`,
      `Uptime:\t${Date.now() - this.startedAt}ms`,
      `Cmdline:\t${this.argv.join(' ')}`,
      `Cwd:\t${this.cwd}`,
      `Children:\t${[...this.children].join(',') || '-'}`,
      `Mailbox:\t${this.mailbox.length}`,
    ];
    if (this.waitReason) lines.push(`WaitReason:\t${this.waitReason}`);
    if (this.exitCode !== null) lines.push(`ExitCode:\t${this.exitCode}`);
    return `${lines.join('\n')}\n`;
  }
}

/** Scheduler passes a process must be skipped before its priority improves. */
const AGING_INTERVAL = 4;
