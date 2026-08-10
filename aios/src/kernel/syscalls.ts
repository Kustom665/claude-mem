import { FD, type Priority, type SpawnOptions, type SyscallRequest, type Signal, type WaitResult } from './types.ts';

export type { WaitResult };

/**
 * The userland syscall interface — AIOS's libc.
 *
 * Every function here just *describes* a syscall; it performs nothing. A
 * program yields the descriptor and the kernel executes it, so userland code
 * stays a pure description of intent and the kernel keeps full control over
 * scheduling and side effects.
 *
 *   function* main(ctx) {
 *     const text = yield* sys.readFile('/etc/motd');
 *     yield sys.write(FD.STDOUT, text);
 *     return 0;
 *   }
 */
function call(name: string, ...args: unknown[]): SyscallRequest {
  return { call: name, args };
}

export const sys = {
  // ---- process control ----

  /** Start `program` as a child process. Resolves to the new pid. */
  spawn: (program: string, opts: SpawnOptions = {}) => call('spawn', program, opts),
  /** Terminate the calling process with `code`. Never returns. */
  exit: (code = 0) => call('exit', code),
  /** Send `signal` to `pid`. */
  kill: (pid: number, signal: Signal) => call('kill', pid, signal),
  /** Block until `pid` exits. Resolves to a {@link WaitResult}. */
  wait: (pid: number) => call('wait', pid),
  /** The calling process's pid. */
  getpid: () => call('getpid'),
  /** Snapshot of every process in the table. */
  ps: () => call('ps'),
  /** Block for `ms` milliseconds. */
  sleep: (ms: number) => call('sleep', ms),
  /** Give up the rest of this quantum voluntarily. */
  yield: () => call('yield'),
  /** Change the calling process's scheduling priority. */
  setpriority: (priority: Priority) => call('setpriority', priority),
  /** Drain and return signals raised since the last check. */
  signals: () => call('signals'),
  /** Handle `signal` rather than dying on it. SIGKILL/SIGSTOP cannot be caught. */
  catchSignal: (signal: Signal) => call('catchSignal', signal),

  // ---- standard I/O ----

  /** Write to a file descriptor. */
  write: (fd: number, data: string) => call('write', fd, data),
  /** Convenience: write to stdout with a trailing newline. */
  print: (data: string) => call('write', FD.STDOUT, `${data}\n`),
  /** Convenience: write to stderr with a trailing newline. */
  eprint: (data: string) => call('write', FD.STDERR, `${data}\n`),
  /** Read all of stdin. */
  read: () => call('read', FD.STDIN),
  /** Prompt the console and block until a line is entered. Null at EOF. */
  readline: (prompt = '') => call('readline', prompt),

  // ---- filesystem ----

  readFile: (path: string) => call('readFile', path),
  writeFile: (path: string, content: string) => call('writeFile', path, content, false),
  appendFile: (path: string, content: string) => call('writeFile', path, content, true),
  mkdir: (path: string) => call('mkdir', path),
  unlink: (path: string) => call('unlink', path),
  listdir: (path: string) => call('listdir', path),
  stat: (path: string) => call('stat', path),
  exists: (path: string) => call('exists', path),
  chdir: (path: string) => call('chdir', path),
  cwd: () => call('cwd'),

  // ---- IPC ----

  /** Post a message to another process's mailbox. */
  send: (pid: number, subject: string, body: unknown) => call('send', pid, subject, body),
  /**
   * Take the next message from this process's mailbox, blocking until one
   * arrives or `timeoutMs` elapses. Resolves to null on timeout.
   */
  recv: (timeoutMs?: number) => call('recv', timeoutMs),
  /** Post a message to every process except the sender. */
  broadcast: (subject: string, body: unknown) => call('broadcast', subject, body),

  // ---- shared agent memory ----

  /** Store a fact in the OS-wide memory shared by all agents. */
  remember: (key: string, value: string, tags: string[] = []) => call('remember', key, value, tags),
  /** Retrieve facts relevant to `query`, best match first. */
  recall: (query: string, limit = 5) => call('recall', query, limit),
  /** Delete a stored fact. */
  forget: (key: string) => call('forget', key),

  // ---- sockets ----

  /**
   * Open a WebSocket connection. Blocks until the handshake completes and
   * resolves to a file descriptor. Descriptors are per-process and are closed
   * automatically when the process exits.
   */
  connect: (url: string) => call('connect', url),
  /** Send a frame. */
  sockSend: (fd: number, data: string) => call('sockSend', fd, data),
  /** Block for the next frame. Resolves to null once the peer closes. */
  sockRecv: (fd: number) => call('sockRecv', fd),
  /** Close a socket. */
  sockClose: (fd: number) => call('sockClose', fd),

  // ---- inference ----

  /**
   * Run a prompt through the configured model. Blocks the calling process;
   * the kernel keeps scheduling everyone else while it is in flight.
   */
  infer: (prompt: string, opts: InferOptions = {}) => call('infer', prompt, opts),

  // ---- environment ----

  getenv: (key: string) => call('getenv', key),
  setenv: (key: string, value: string) => call('setenv', key, value),
  /** Every registered program (the contents of /bin), with its help text. */
  programs: () => call('programs'),
  /** Kernel-wide counters: uptime, context switches, process count. */
  sysinfo: () => call('sysinfo'),
  /** Stop the kernel. Requires pid 1. */
  halt: () => call('halt'),
} as const;

export interface InferOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export { FD };
