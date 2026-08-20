/**
 * AIOS core types.
 *
 * The central idea: a userland program is a *generator* that yields syscall
 * requests. The kernel drives the generator, performs each syscall, and sends
 * the result back in via `gen.next(result)`. That gives us three things a
 * plain `async function` cannot:
 *
 *   1. A real syscall boundary — userland never touches kernel state directly.
 *   2. Real preemption — the kernel counts syscalls and can suspend a process
 *      mid-flight when its quantum expires.
 *   3. Real blocking — an async syscall (an LLM call, a sleep) parks *that*
 *      process while the kernel keeps scheduling everyone else.
 */

/** Process lifecycle states. */
export enum ProcState {
  /** Created, not yet admitted to the run queue. */
  NEW = 'new',
  /** Runnable, waiting for CPU. */
  READY = 'ready',
  /** Currently executing on the (single) CPU. */
  RUNNING = 'running',
  /** Waiting on an async syscall or an IPC receive. */
  BLOCKED = 'blocked',
  /** Stopped by SIGSTOP, resumable with SIGCONT. */
  STOPPED = 'stopped',
  /** Exited; PCB retained until the parent reaps it. */
  ZOMBIE = 'zombie',
  /** Reaped. Removed from the process table. */
  TERMINATED = 'terminated',
}

/** Signals. Semantics mirror POSIX closely enough to be unsurprising. */
export enum Signal {
  /** Polite shutdown request. Catchable by the process. */
  SIGTERM = 'SIGTERM',
  /** Immediate, uncatchable termination. */
  SIGKILL = 'SIGKILL',
  /** Interrupt (Ctrl-C). Catchable. */
  SIGINT = 'SIGINT',
  /** Suspend. Uncatchable. */
  SIGSTOP = 'SIGSTOP',
  /** Resume a stopped process. */
  SIGCONT = 'SIGCONT',
  /** A child changed state. Delivered to the parent. */
  SIGCHLD = 'SIGCHLD',
}

/** Scheduling priority. Lower number == higher priority, as in nice(2). */
export type Priority = number;

export const PRIORITY = {
  REALTIME: -10,
  HIGH: -5,
  NORMAL: 0,
  LOW: 5,
  IDLE: 19,
} as const;

/** Standard file descriptors. */
export const FD = { STDIN: 0, STDOUT: 1, STDERR: 2 } as const;

/**
 * A syscall request, as yielded by a program generator.
 * `call` selects the handler; `args` are passed positionally.
 */
export interface SyscallRequest {
  readonly call: string;
  readonly args: readonly unknown[];
}

/** What a program generator yields, returns, and receives on resume. */
export type ProgramGenerator = Generator<SyscallRequest, number | void, any>;

/** Read-only view of a process handed to userland as `ctx`. */
export interface ProcessContext {
  readonly pid: number;
  readonly ppid: number;
  /** argv[0] is the program name, as is conventional. */
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

/** A userland program: the OS equivalent of an executable in /bin. */
export interface Program {
  readonly name: string;
  readonly description: string;
  /** Usage line shown by `help`. */
  readonly usage?: string;
  /**
   * Entry point. Yields syscalls, returns an exit code (0 == success).
   * Returning void is treated as exit code 0.
   */
  main(ctx: ProcessContext): ProgramGenerator;
}

/**
 * What `wait` resolves to.
 *
 * A POSIX wait yields only a status code, because output has already gone down
 * a file descriptor wired up before the fork. AIOS buffers process output
 * instead, so wait hands back the captured streams along with the code — that
 * is what lets the shell build pipelines and `pipeline` chain agents.
 */
export interface WaitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** An IPC message delivered to a process mailbox. */
export interface Message {
  readonly from: number;
  readonly to: number;
  readonly subject: string;
  readonly body: unknown;
  readonly timestamp: number;
}

/** Options accepted by the `spawn` syscall. */
export interface SpawnOptions {
  readonly argv?: readonly string[];
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly priority?: Priority;
  /** Detach from the parent so the shell does not wait on it. */
  readonly detached?: boolean;
  /**
   * When true (the default) stdout also streams to the console. Pipelines set
   * it false so output is captured into the buffer instead of the terminal.
   */
  readonly tty?: boolean;
  /** Initial stdin contents, used to feed the left side of a pipe. */
  readonly stdin?: string;
}

/** Snapshot of a process, as reported by `ps` and /proc. */
export interface ProcessInfo {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
  readonly state: ProcState;
  readonly priority: Priority;
  readonly cpuTime: number;
  readonly startedAt: number;
  readonly exitCode: number | null;
  readonly argv: readonly string[];
  /** Human-readable reason the process is blocked, when it is. */
  readonly waitReason: string | null;
}

/** A node in the virtual filesystem. */
export interface VNode {
  name: string;
  type: 'file' | 'dir';
  content: string;
  children: Map<string, VNode>;
  createdAt: number;
  modifiedAt: number;
  /** Set on synthetic nodes such as /proc, whose content is generated on read. */
  readonly synthetic?: boolean;
}
