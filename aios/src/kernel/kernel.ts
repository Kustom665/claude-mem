import { Process } from './process.ts';
import { Scheduler } from './scheduler.ts';
import { VFS } from './vfs.ts';
import { MemoryStore } from './memory.ts';
import { ProcState, Signal, FD, PRIORITY } from './types.ts';
import type { Message, ProcessInfo, Program, SpawnOptions, SyscallRequest } from './types.ts';
import { ENOENT, ENOEXEC, ENOSYS, ESRCH, EACCES, KernelError } from './errors.ts';
import type { ConsoleDevice } from './console.ts';
import { WebSocketNetwork, redactUrl, type NetworkDevice, type Socket } from './net.ts';
import type { LLMProvider } from '../llm/provider.ts';
import type { InferOptions } from './syscalls.ts';

/** Syscalls a process may execute before the kernel preempts it. */
const QUANTUM = 64;

/** Thrown by the `exit` syscall to unwind a process cleanly. */
class ExitSignal extends Error {
  constructor(readonly code: number) {
    super('exit');
  }
}

/** Returned by the `yield` syscall to end the current time slice early. */
const YIELD = Symbol('yield');

export interface KernelOptions {
  console: ConsoleDevice;
  llm: LLMProvider;
  /** Defaults to real WebSockets. Tests substitute a scripted network. */
  net?: NetworkDevice;
  /** Keep the kernel alive even when no process is runnable or blocked. */
  keepAlive?: boolean;
}

/**
 * The AIOS kernel.
 *
 * Drives a single virtual CPU: it picks a process, resumes its generator, and
 * services each syscall it yields. Synchronous syscalls return inline;
 * asynchronous ones (inference, sleep, console reads, IPC waits) park that
 * process in BLOCKED and hand the CPU to somebody else, which is what lets a
 * dozen agents wait on model calls concurrently without threads.
 */
export class Kernel {
  readonly vfs = new VFS();
  readonly scheduler = new Scheduler();
  readonly memory = new MemoryStore();
  readonly processes = new Map<number, Process>();
  readonly programs = new Map<string, Program>();
  readonly console: ConsoleDevice;
  readonly llm: LLMProvider;
  readonly net: NetworkDevice;
  readonly bootedAt = Date.now();

  /** Open sockets by file descriptor. 0-2 are reserved for stdio. */
  private readonly sockets = new Map<number, { socket: Socket; owner: number; url: string }>();
  private nextFd = 3;

  keepAlive: boolean;
  running = false;
  /** Set when the kernel halts, so `boot` callers can await a clean shutdown. */
  private haltResolvers: Array<() => void> = [];

  private nextPid = 1;
  /** Processes blocked in `recv`, keyed by pid. */
  private recvWaiters = new Map<number, (msg: Message | null) => void>();

  private wakeupPromise: Promise<void> | null = null;
  private wakeupResolve: (() => void) | null = null;
  private wakeupPending = false;

  constructor(opts: KernelOptions) {
    this.console = opts.console;
    this.llm = opts.llm;
    this.net = opts.net ?? new WebSocketNetwork();
    this.keepAlive = opts.keepAlive ?? false;
    this.mountProc();
  }

  // ---------------------------------------------------------------- registry

  /** Install a program into /bin. */
  register(...programs: Program[]): void {
    for (const program of programs) this.programs.set(program.name, program);
  }

  // ------------------------------------------------------------------ spawn

  /**
   * Create a process. It is admitted to the run queue immediately but does not
   * execute until the scheduler picks it.
   */
  spawn(programName: string, opts: SpawnOptions = {}, parent: Process | null = null): Process {
    const program = this.programs.get(programName);
    if (!program) throw new ENOEXEC(programName);

    const proc = new Process({
      pid: this.nextPid++,
      ppid: parent?.pid ?? 0,
      program,
      argv: opts.argv ?? [programName],
      env: { ...(parent?.env ?? {}), ...(opts.env ?? {}) },
      cwd: opts.cwd ?? parent?.cwd ?? '/home',
      priority: opts.priority ?? PRIORITY.NORMAL,
    });

    proc.tty = opts.tty ?? true;
    proc.stdin = opts.stdin ?? '';
    proc.detached = opts.detached ?? false;

    this.processes.set(proc.pid, proc);
    if (parent && !proc.detached) parent.children.add(proc.pid);

    this.scheduler.enqueue(proc);
    this.signalWakeup();
    return proc;
  }

  // -------------------------------------------------------------- main loop

  /** Run until every process has exited (or `halt` is called). */
  async boot(): Promise<void> {
    this.running = true;
    while (this.running) {
      const proc = this.scheduler.next();

      if (!proc) {
        // Nothing runnable. If something can still wake us, wait for it.
        if (this.hasWaking() || this.keepAlive) {
          await this.waitForWakeup();
          continue;
        }
        break; // idle and unwakeable — halt
      }

      if (proc.exitCode !== null) continue; // died while queued
      await this.runSlice(proc);
    }

    this.running = false;
    for (const resolve of this.haltResolvers.splice(0)) resolve();
  }

  /**
   * True if any process could still become runnable.
   *
   * STOPPED counts: a suspended process is revived by SIGCONT, which can come
   * from outside the kernel loop, so halting on it would silently discard a
   * process that was only meant to be paused.
   */
  private hasWaking(): boolean {
    for (const proc of this.processes.values()) {
      if (proc.state === ProcState.BLOCKED || proc.state === ProcState.STOPPED) return true;
    }
    return false;
  }

  /**
   * Execute one time slice: resume the process and service its syscalls until
   * the quantum expires, it blocks, it yields, or it exits.
   */
  private async runSlice(proc: Process): Promise<void> {
    proc.state = ProcState.RUNNING;
    if (!proc.gen) proc.gen = proc.program.main(proc.context());

    for (let step = 0; step < QUANTUM; step++) {
      if (this.applyPendingSignals(proc)) return; // died or stopped

      let next: IteratorResult<SyscallRequest, number | void>;
      try {
        if (proc.resumeError) {
          const err = proc.resumeError;
          proc.resumeError = null;
          next = proc.gen.throw(err);
        } else {
          const value = proc.resumeValue;
          proc.resumeValue = undefined;
          next = proc.gen.next(value);
        }
      } catch (err) {
        if (err instanceof ExitSignal) {
          this.exit(proc, err.code);
        } else {
          // Uncaught error in userland: report it and exit non-zero, the way a
          // real program would die rather than taking the kernel with it.
          this.writeTo(proc, FD.STDERR, `${proc.name}: ${(err as Error).message}\n`);
          this.exit(proc, 1);
        }
        return;
      }

      if (next.done) {
        this.exit(proc, typeof next.value === 'number' ? next.value : 0);
        return;
      }

      proc.cpuTime++;

      let result: unknown;
      try {
        result = this.syscall(proc, next.value);
      } catch (err) {
        if (err instanceof ExitSignal) {
          this.exit(proc, err.code);
          return;
        }
        // Syscall failures surface inside the program, where they can be caught.
        proc.resumeError = err as Error;
        continue;
      }

      if (result === YIELD) break;

      if (result instanceof Promise) {
        this.block(proc, next.value.call, result);
        return; // the CPU goes to somebody else while this one waits
      }

      proc.resumeValue = result;
    }

    // Quantum expired (or the process yielded): back of the queue.
    if (proc.exitCode === null && proc.state === ProcState.RUNNING) {
      this.scheduler.enqueue(proc);
    }
  }

  /** Park a process on a promise and wake it when the promise settles. */
  private block(proc: Process, reason: string, promise: Promise<unknown>): void {
    proc.state = ProcState.BLOCKED;
    proc.waitReason = reason;
    promise.then(
      (value) => {
        proc.resumeValue = value;
        this.unblock(proc);
      },
      (err) => {
        proc.resumeError = err instanceof Error ? err : new Error(String(err));
        this.unblock(proc);
      },
    );
  }

  private unblock(proc: Process): void {
    // The process may have been killed while it was waiting; if so, the
    // resolved value is simply discarded.
    if (proc.exitCode !== null || proc.state === ProcState.TERMINATED) return;
    proc.waitReason = null;
    if (proc.state === ProcState.STOPPED) return; // SIGCONT will requeue it
    this.scheduler.enqueue(proc);
    this.signalWakeup();
  }

  /**
   * Deliver pending signals. Returns true if the process should stop running
   * this slice (because it died or was suspended).
   */
  private applyPendingSignals(proc: Process): boolean {
    while (proc.pendingSignals.length > 0) {
      const signal = proc.pendingSignals[0]!;

      if (signal === Signal.SIGKILL) {
        proc.pendingSignals.shift();
        this.exit(proc, 137);
        return true;
      }
      if (signal === Signal.SIGSTOP) {
        proc.pendingSignals.shift();
        proc.state = ProcState.STOPPED;
        this.scheduler.remove(proc);
        return true;
      }
      if (signal === Signal.SIGCONT) {
        proc.pendingSignals.shift();
        continue;
      }
      // Catchable: leave it queued for sys.signals() if the process opted in.
      if (proc.caughtSignals.has(signal)) return false;
      proc.pendingSignals.shift();
      if (signal === Signal.SIGCHLD) continue; // ignored by default
      this.exit(proc, signal === Signal.SIGINT ? 130 : 143);
      return true;
    }
    return false;
  }

  /** Terminate a process, orphan its children, and notify its parent. */
  private exit(proc: Process, code: number): void {
    if (proc.exitCode !== null) return;

    this.scheduler.remove(proc);
    proc.terminate(code);

    // Release kernel resources the process was holding, or a killed daemon
    // would leave its connection open for the life of the system.
    this.closeSocketsOf(proc.pid);

    // Anything blocked receiving from this process must not wait forever.
    const waiter = this.recvWaiters.get(proc.pid);
    if (waiter) {
      this.recvWaiters.delete(proc.pid);
      waiter(null);
    }

    // Re-parent children to init (pid 1), as a real OS does.
    for (const childPid of proc.children) {
      const child = this.processes.get(childPid);
      if (child) child.ppid = 1;
    }
    proc.children.clear();

    const parent = this.processes.get(proc.ppid);
    if (proc.detached) {
      // Nobody is going to wait() on a detached process, so reap it here
      // rather than leaving a zombie behind forever.
      this.reap(proc.pid);
    } else if (parent && parent.exitCode === null) {
      parent.pendingSignals.push(Signal.SIGCHLD);
      if (parent.state === ProcState.BLOCKED) this.signalWakeup();
    } else {
      // No live parent to reap us: release the PCB immediately.
      this.reap(proc.pid);
    }

    this.signalWakeup();
  }

  /** Release a zombie's PCB. */
  private reap(pid: number): void {
    const proc = this.processes.get(pid);
    if (!proc || proc.exitCode === null) return;
    proc.state = ProcState.TERMINATED;
    this.processes.delete(pid);
    this.processes.get(proc.ppid)?.children.delete(pid);
  }

  // ------------------------------------------------------------- wakeup gate

  private waitForWakeup(): Promise<void> {
    // A wakeup that arrived before we started waiting must not be lost, or the
    // kernel would sleep forever with runnable work sitting in the queue.
    if (this.wakeupPending) {
      this.wakeupPending = false;
      return Promise.resolve();
    }
    if (!this.wakeupPromise) {
      this.wakeupPromise = new Promise<void>((resolve) => {
        this.wakeupResolve = resolve;
      });
    }
    return this.wakeupPromise;
  }

  private signalWakeup(): void {
    if (this.wakeupResolve) {
      const resolve = this.wakeupResolve;
      this.wakeupPromise = null;
      this.wakeupResolve = null;
      resolve();
    } else {
      this.wakeupPending = true;
    }
  }

  /** Stop the kernel loop. Resolves once `boot` has returned. */
  halt(): Promise<void> {
    this.running = false;
    this.keepAlive = false;
    const done = new Promise<void>((resolve) => this.haltResolvers.push(resolve));
    this.signalWakeup();
    return done;
  }

  // -------------------------------------------------------------- syscalls

  /** Dispatch one syscall. Returns a value, a promise (blocks), or YIELD. */
  private syscall(proc: Process, req: SyscallRequest): unknown {
    const [a, b, c] = req.args;

    switch (req.call) {
      // ---- process control ----
      case 'spawn': {
        const opts = (b ?? {}) as SpawnOptions;
        return this.spawn(a as string, opts, proc).pid;
      }
      case 'exit':
        throw new ExitSignal((a as number) ?? 0);
      case 'kill': {
        const target = this.processes.get(a as number);
        if (!target || target.exitCode !== null) throw new ESRCH(a as number);
        this.signal(target, b as Signal);
        return true;
      }
      case 'wait': {
        const child = this.processes.get(a as number);
        if (!child) throw new ESRCH(a as number);
        return child.exited.then((code) => {
          // Snapshot the streams before the PCB goes away.
          const result = { code, stdout: child.stdout, stderr: child.stderr };
          this.reap(child.pid);
          return result;
        });
      }
      case 'getpid':
        return proc.pid;
      case 'ps':
        return this.processList();
      case 'sleep':
        return new Promise((resolve) => setTimeout(resolve, Math.max(0, a as number)));
      case 'yield':
        this.scheduler.enqueue(proc);
        return YIELD;
      case 'setpriority':
        proc.priority = a as number;
        return proc.priority;
      case 'signals':
        return proc.pendingSignals.splice(0);
      case 'catchSignal':
        proc.caughtSignals.add(a as Signal);
        return true;

      // ---- standard I/O ----
      case 'write':
        this.writeTo(proc, a as number, b as string);
        return (b as string).length;
      case 'read': {
        const data = proc.stdin;
        proc.stdin = '';
        return data;
      }
      case 'readline':
        return this.console.readLine((a as string) ?? '');

      // ---- filesystem ----
      case 'readFile':
        return this.vfs.read(this.vfs.resolve(a as string, proc.cwd));
      case 'writeFile':
        this.vfs.write(this.vfs.resolve(a as string, proc.cwd), b as string, c as boolean);
        return true;
      case 'mkdir':
        this.vfs.mkdirp(this.vfs.resolve(a as string, proc.cwd));
        return true;
      case 'unlink':
        this.vfs.unlink(this.vfs.resolve(a as string, proc.cwd));
        return true;
      case 'listdir':
        return this.vfs.list(this.vfs.resolve(a as string, proc.cwd));
      case 'stat':
        return this.vfs.stat(this.vfs.resolve(a as string, proc.cwd));
      case 'exists':
        return this.vfs.exists(this.vfs.resolve(a as string, proc.cwd));
      case 'chdir': {
        const target = this.vfs.resolve(a as string, proc.cwd);
        if (!this.vfs.exists(target)) throw new ENOENT(target);
        if (!this.vfs.isDir(target)) throw new KernelError(`not a directory: ${target}`, 'ENOTDIR');
        proc.cwd = target;
        return target;
      }
      case 'cwd':
        return proc.cwd;

      // ---- IPC ----
      case 'send': {
        const target = this.processes.get(a as number);
        if (!target || target.exitCode !== null) throw new ESRCH(a as number);
        this.deliver(target, { from: proc.pid, to: target.pid, subject: b as string, body: c, timestamp: Date.now() });
        return true;
      }
      case 'recv': {
        const queued = proc.mailbox.shift();
        if (queued) return queued;
        return new Promise<Message | null>((resolve) => {
          let settled = false;
          const finish = (msg: Message | null) => {
            if (settled) return;
            settled = true;
            this.recvWaiters.delete(proc.pid);
            resolve(msg);
          };
          this.recvWaiters.set(proc.pid, finish);
          const timeout = a as number | undefined;
          if (typeof timeout === 'number' && timeout >= 0) {
            setTimeout(() => finish(null), timeout);
          }
        });
      }
      case 'broadcast': {
        let count = 0;
        for (const target of this.processes.values()) {
          if (target.pid === proc.pid || target.exitCode !== null) continue;
          this.deliver(target, { from: proc.pid, to: target.pid, subject: a as string, body: b, timestamp: Date.now() });
          count++;
        }
        return count;
      }

      // ---- shared memory ----
      case 'remember':
        this.memory.remember(a as string, b as string, (c as string[]) ?? [], proc.pid);
        return true;
      case 'recall':
        return this.memory.recall(a as string, (b as number) ?? 5);
      case 'forget':
        return this.memory.forget(a as string);

      // ---- sockets ----
      case 'connect': {
        const url = a as string;
        const owner = proc.pid;
        return this.net.connect(url).then((socket) => {
          // The process may have died while the handshake was in flight.
          if (this.processes.get(owner)?.exitCode != null || !this.processes.has(owner)) {
            socket.close();
            throw new KernelError(`connection abandoned: process ${owner} exited`, 'ESRCH');
          }
          const fd = this.nextFd++;
          this.sockets.set(fd, { socket, owner, url: redactUrl(url) });
          return fd;
        });
      }
      case 'sockSend': {
        const entry = this.socketFor(proc, a as number);
        entry.socket.send(b as string);
        return true;
      }
      case 'sockRecv':
        return this.socketFor(proc, a as number).socket.recv();
      case 'sockClose': {
        const fd = a as number;
        const entry = this.socketFor(proc, fd);
        entry.socket.close();
        this.sockets.delete(fd);
        return true;
      }

      // ---- inference ----
      case 'infer':
        return this.llm.complete(a as string, (b as InferOptions) ?? {});

      // ---- environment ----
      case 'getenv':
        return proc.env[a as string] ?? '';
      case 'setenv':
        proc.env[a as string] = b as string;
        return true;
      case 'programs':
        return [...this.programs.values()]
          .map((p) => ({ name: p.name, description: p.description, usage: p.usage ?? p.name }))
          .sort((x, y) => x.name.localeCompare(y.name));
      case 'sysinfo':
        return this.sysinfo();
      case 'halt':
        if (proc.pid !== 1) throw new EACCES('halt requires pid 1');
        void this.halt();
        throw new ExitSignal(0);

      default:
        throw new ENOSYS(req.call);
    }
  }

  /** Resolve a file descriptor, enforcing that the caller owns it. */
  private socketFor(proc: Process, fd: number): { socket: Socket; owner: number; url: string } {
    const entry = this.sockets.get(fd);
    if (!entry) throw new KernelError(`bad file descriptor: ${fd}`, 'EBADF');
    // Descriptors are per-process; there is no dup/inherit, so another
    // process holding this fd number would be a bug, not a feature.
    if (entry.owner !== proc.pid) throw new EACCES(`fd ${fd} belongs to process ${entry.owner}`);
    return entry;
  }

  /** Close every socket owned by a process. Called when it exits. */
  private closeSocketsOf(pid: number): void {
    for (const [fd, entry] of this.sockets) {
      if (entry.owner !== pid) continue;
      try {
        entry.socket.close();
      } catch {
        /* already closed */
      }
      this.sockets.delete(fd);
    }
  }

  /** Queue a message, waking the target if it is blocked in `recv`. */
  private deliver(target: Process, message: Message): void {
    const waiter = this.recvWaiters.get(target.pid);
    if (waiter) {
      waiter(message);
      return;
    }
    target.mailbox.push(message);
  }

  /** Raise a signal against a process. */
  signal(target: Process, signal: Signal): void {
    if (target.exitCode !== null) return;

    if (signal === Signal.SIGCONT && target.state === ProcState.STOPPED) {
      target.state = ProcState.READY;
      this.scheduler.enqueue(target);
      this.signalWakeup();
      return;
    }

    target.pendingSignals.push(signal);

    // A blocked or stopped process is not going to reach the signal check on
    // its own, so fatal signals have to be applied here.
    if (signal === Signal.SIGKILL) {
      this.exit(target, 137);
      return;
    }
    if (target.state === ProcState.BLOCKED && !target.caughtSignals.has(signal)) {
      if (signal === Signal.SIGTERM || signal === Signal.SIGINT) {
        this.exit(target, signal === Signal.SIGINT ? 130 : 143);
        return;
      }
    }
    this.signalWakeup();
  }

  /** Route a write to the buffer, and to the console when attached to a tty. */
  private writeTo(proc: Process, fd: number, data: string): void {
    if (fd === FD.STDERR) {
      proc.stderr += data;
      if (proc.tty) this.console.write(data);
      return;
    }
    proc.stdout += data;
    if (proc.tty) this.console.write(data);
  }

  processList(): ProcessInfo[] {
    return [...this.processes.values()]
      .sort((a, b) => a.pid - b.pid)
      .map((p) => p.info());
  }

  sysinfo(): Record<string, unknown> {
    return {
      uptimeMs: Date.now() - this.bootedAt,
      processes: this.processes.size,
      runnable: this.scheduler.length,
      contextSwitches: this.scheduler.contextSwitches,
      memoryEntries: this.memory.size,
      provider: this.llm.name,
      network: this.net.name,
      openSockets: this.sockets.size,
      programs: this.programs.size,
    };
  }

  // ------------------------------------------------------------------ /proc

  /**
   * Mount /proc. Contents are generated at read time, so `cat /proc/3/status`
   * always reflects live kernel state.
   */
  private mountProc(): void {
    const parse = (rel: string) => rel.split('/').filter(Boolean);

    this.vfs.mountSynthetic('/proc', {
      exists: (rel) => {
        const parts = parse(rel);
        if (parts.length === 0) return true;
        if (parts.length === 1) {
          return PROC_FILES.has(parts[0]!) || this.processes.has(Number(parts[0]));
        }
        if (parts.length === 2) {
          return this.processes.has(Number(parts[0])) && PROC_PID_FILES.has(parts[1]!);
        }
        return false;
      },
      isDir: (rel) => {
        const parts = parse(rel);
        if (parts.length === 0) return true;
        return parts.length === 1 && this.processes.has(Number(parts[0]));
      },
      list: (rel) => {
        const parts = parse(rel);
        if (parts.length === 0) {
          return [...PROC_FILES, ...[...this.processes.keys()].sort((a, b) => a - b).map(String)];
        }
        return [...PROC_PID_FILES];
      },
      read: (rel) => {
        const parts = parse(rel);
        if (parts.length === 1) {
          switch (parts[0]) {
            case 'uptime':
              return `${((Date.now() - this.bootedAt) / 1000).toFixed(2)}s\n`;
            case 'meminfo': {
              const entries = this.memory.all();
              return [
                `Entries:\t${entries.length}`,
                `Authors:\t${new Set(entries.map((e) => e.author)).size}`,
                `TotalBytes:\t${entries.reduce((n, e) => n + e.value.length, 0)}`,
                '',
                ...entries.map((e) => `${e.key}\t[${e.tags.join(',')}]\tpid=${e.author}\thits=${e.hits}`),
              ].join('\n');
            }
            case 'programs':
              return `${[...this.programs.keys()].sort().join('\n')}\n`;
            case 'sysinfo':
              return `${JSON.stringify(this.sysinfo(), null, 2)}\n`;
            default:
              throw new ENOENT(`/proc/${rel}`);
          }
        }
        const proc = this.processes.get(Number(parts[0]));
        if (!proc) throw new ENOENT(`/proc/${rel}`);
        switch (parts[1]) {
          case 'status':
            return proc.procStatus();
          case 'cmdline':
            return `${proc.argv.join(' ')}\n`;
          case 'stdout':
            return proc.stdout;
          case 'stderr':
            return proc.stderr;
          default:
            throw new ENOENT(`/proc/${rel}`);
        }
      },
    });
  }
}

const PROC_FILES = new Set(['uptime', 'meminfo', 'programs', 'sysinfo']);
const PROC_PID_FILES = new Set(['status', 'cmdline', 'stdout', 'stderr']);
