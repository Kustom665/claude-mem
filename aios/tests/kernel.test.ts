import { describe, expect, test } from 'bun:test';
import { sys } from '../src/kernel/syscalls.ts';
import { ProcState, Signal, PRIORITY, type Program, type WaitResult } from '../src/kernel/types.ts';
import { Scheduler } from '../src/kernel/scheduler.ts';
import { Process } from '../src/kernel/process.ts';
import { makeKernel, ConcurrencyProbeProvider, FailingProvider } from './helpers.ts';

const noop: Program = { name: 'noop', description: 'test', *main() { return 0; } };

describe('process lifecycle', () => {
  test('a program exit code is its return value', async () => {
    const { kernel } = makeKernel({
      programs: [{ name: 'ret', description: '', *main() { return 42; } }],
    });
    const proc = kernel.spawn('ret');
    await kernel.boot();
    expect(proc.exitCode).toBe(42);
  });

  test('returning nothing exits 0', async () => {
    const { kernel } = makeKernel({
      programs: [{ name: 'void', description: '', *main() {} }],
    });
    const proc = kernel.spawn('void');
    await kernel.boot();
    expect(proc.exitCode).toBe(0);
  });

  test('sys.exit terminates immediately, skipping later statements', async () => {
    const { kernel } = makeKernel({
      programs: [{
        name: 'early',
        description: '',
        *main() {
          yield sys.print('before');
          yield sys.exit(7);
          yield sys.print('after');
          return 0;
        },
      }],
    });
    const proc = kernel.spawn('early');
    await kernel.boot();
    expect(proc.exitCode).toBe(7);
    expect(proc.stdout).toBe('before\n');
  });

  test('an uncaught error kills only the offending process', async () => {
    const { kernel } = makeKernel({
      programs: [
        { name: 'boom', description: '', *main() { throw new Error('kaboom'); } },
        { name: 'fine', description: '', *main() { yield sys.print('ok'); return 0; } },
      ],
    });
    const bad = kernel.spawn('boom');
    const good = kernel.spawn('fine');
    await kernel.boot();

    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain('kaboom');
    expect(good.exitCode).toBe(0);
    expect(good.stdout).toBe('ok\n');
  });

  test('wait returns the child exit code and captured output', async () => {
    const { kernel } = makeKernel({
      programs: [
        { name: 'child', description: '', *main() { yield sys.print('from child'); return 3; } },
        {
          name: 'parent',
          description: '',
          *main() {
            const pid: number = yield sys.spawn('child', { tty: false });
            const result: WaitResult = yield sys.wait(pid);
            yield sys.print(`code=${result.code} out=${result.stdout.trim()}`);
            return 0;
          },
        },
      ],
    });
    const parent = kernel.spawn('parent', { tty: false });
    await kernel.boot();
    expect(parent.stdout.trim()).toBe('code=3 out=from child');
  });

  test('orphans are re-parented to init', async () => {
    const { kernel } = makeKernel({
      programs: [
        { name: 'holder', description: '', *main() { yield sys.sleep(60); return 0; } },
        { name: 'longchild', description: '', *main() { yield sys.sleep(40); return 0; } },
        {
          name: 'quitter',
          description: '',
          *main() {
            // Exits immediately, leaving the child running with a dead parent.
            yield sys.spawn('longchild', { tty: false });
            return 0;
          },
        },
      ],
    });

    kernel.spawn('holder', { tty: false }); // occupies pid 1
    const quitter = kernel.spawn('quitter', { tty: false }); // pid 2
    const booted = kernel.boot();

    await new Promise((r) => setTimeout(r, 15));
    const orphan = [...kernel.processes.values()].find((p) => p.name === 'longchild');
    expect(quitter.exitCode).toBe(0);
    expect(orphan).toBeDefined();
    expect(orphan!.ppid).toBe(1);

    await booted;
  });
});

describe('signals', () => {
  test('SIGKILL terminates a process blocked on sleep', async () => {
    const { kernel } = makeKernel({
      programs: [
        { name: 'sleeper', description: '', *main() { yield sys.sleep(5000); return 0; } },
        {
          name: 'killer',
          description: '',
          *main() {
            const pid: number = yield sys.spawn('sleeper', { tty: false });
            yield sys.sleep(5); // let it reach the blocking call
            yield sys.kill(pid, Signal.SIGKILL);
            return 0;
          },
        },
      ],
    });

    const killer = kernel.spawn('killer', { tty: false });
    // Without the kill this would hang for 5s; the test timeout guards that.
    await kernel.boot();
    expect(killer.exitCode).toBe(0);
  });

  test('SIGTERM sets exit code 143', async () => {
    const { kernel } = makeKernel({
      programs: [
        { name: 'sleeper', description: '', *main() { yield sys.sleep(5000); return 0; } },
      ],
    });
    const victim = kernel.spawn('sleeper', { tty: false });

    // Deliver the signal once the victim is actually blocked.
    const booted = kernel.boot();
    await new Promise((r) => setTimeout(r, 10));
    kernel.signal(victim, Signal.SIGTERM);
    await booted;

    expect(victim.exitCode).toBe(143);
  });

  test('a caught signal is delivered to the process instead of killing it', async () => {
    const { kernel } = makeKernel({
      programs: [{
        name: 'catcher',
        description: '',
        *main() {
          yield sys.catchSignal(Signal.SIGTERM);
          for (let i = 0; i < 200; i++) {
            const signals: Signal[] = yield sys.signals();
            if (signals.includes(Signal.SIGTERM)) {
              yield sys.print('caught');
              return 0;
            }
            yield sys.sleep(1);
          }
          return 99; // never saw the signal
        },
      }],
    });

    const proc = kernel.spawn('catcher', { tty: false });
    const booted = kernel.boot();
    await new Promise((r) => setTimeout(r, 10));
    kernel.signal(proc, Signal.SIGTERM);
    await booted;

    expect(proc.stdout.trim()).toBe('caught');
    expect(proc.exitCode).toBe(0);
  });

  test('SIGSTOP suspends and SIGCONT resumes', async () => {
    const { kernel } = makeKernel({
      programs: [{
        name: 'counter',
        description: '',
        *main() {
          for (let i = 0; i < 5; i++) {
            yield sys.print(String(i));
            yield sys.sleep(2);
          }
          return 0;
        },
      }],
    });

    const proc = kernel.spawn('counter', { tty: false });
    const booted = kernel.boot();

    await new Promise((r) => setTimeout(r, 5));
    kernel.signal(proc, Signal.SIGSTOP);
    await new Promise((r) => setTimeout(r, 15));
    const whileStopped = proc.stdout;
    expect(proc.state).toBe(ProcState.STOPPED);

    kernel.signal(proc, Signal.SIGCONT);
    await booted;

    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.length).toBeGreaterThan(whileStopped.length);
  });
});

describe('IPC', () => {
  test('send and recv move a message between processes', async () => {
    const { kernel } = makeKernel({
      programs: [
        {
          name: 'receiver',
          description: '',
          *main() {
            const msg: { subject: string; body: unknown; from: number } = yield sys.recv(1000);
            yield sys.print(`${msg.subject}:${String(msg.body)}`);
            return 0;
          },
        },
        {
          name: 'sender',
          description: '',
          *main(ctx) {
            const pid = Number(ctx.argv[1]);
            yield sys.send(pid, 'greeting', 'hello');
            return 0;
          },
        },
      ],
    });

    const receiver = kernel.spawn('receiver', { tty: false });
    kernel.spawn('sender', { argv: ['sender', String(receiver.pid)], tty: false });
    await kernel.boot();

    expect(receiver.stdout.trim()).toBe('greeting:hello');
  });

  test('recv times out and resolves null', async () => {
    const { kernel } = makeKernel({
      programs: [{
        name: 'waiter',
        description: '',
        *main() {
          const msg = yield sys.recv(10);
          yield sys.print(msg === null ? 'timeout' : 'got message');
          return 0;
        },
      }],
    });
    const proc = kernel.spawn('waiter', { tty: false });
    await kernel.boot();
    expect(proc.stdout.trim()).toBe('timeout');
  });

  test('broadcast reaches every other process', async () => {
    const { kernel } = makeKernel({
      programs: [
        {
          name: 'listener',
          description: '',
          *main() {
            const msg: { subject: string } = yield sys.recv(1000);
            yield sys.print(msg ? msg.subject : 'none');
            return 0;
          },
        },
        {
          name: 'announcer',
          description: '',
          *main() {
            yield sys.sleep(5); // let the listeners block on recv first
            const count: number = yield sys.broadcast('alert', 'x');
            yield sys.print(`sent=${count}`);
            return 0;
          },
        },
      ],
    });

    const a = kernel.spawn('listener', { tty: false });
    const b = kernel.spawn('listener', { tty: false });
    kernel.spawn('announcer', { tty: false });
    await kernel.boot();

    expect(a.stdout.trim()).toBe('alert');
    expect(b.stdout.trim()).toBe('alert');
  });
});

describe('scheduler', () => {
  const dummy = (pid: number, priority: number) =>
    new Process({ pid, ppid: 0, program: noop, argv: ['noop'], env: {}, cwd: '/', priority });

  test('higher priority (lower number) runs first', () => {
    const scheduler = new Scheduler();
    const low = dummy(1, PRIORITY.LOW);
    const high = dummy(2, PRIORITY.HIGH);
    scheduler.enqueue(low);
    scheduler.enqueue(high);
    expect(scheduler.next()?.pid).toBe(2);
  });

  test('equal priorities run round-robin in FIFO order', () => {
    const scheduler = new Scheduler();
    const a = dummy(1, 0);
    const b = dummy(2, 0);
    scheduler.enqueue(a);
    scheduler.enqueue(b);
    expect(scheduler.next()?.pid).toBe(1);
    expect(scheduler.next()?.pid).toBe(2);
  });

  test('aging stops a low-priority process from starving', () => {
    const scheduler = new Scheduler();
    const starved = dummy(1, PRIORITY.LOW);
    scheduler.enqueue(starved);

    // Keep feeding the queue high-priority work. The guarantee under test is
    // that the wait is *bounded*, not that it is short — so allow generous
    // headroom and assert only that the starved process eventually runs.
    let switchesBeforeStarvedRan = -1;
    for (let i = 0; i < 200 && switchesBeforeStarvedRan === -1; i++) {
      scheduler.enqueue(dummy(100 + i, PRIORITY.HIGH));
      if (scheduler.next()?.pid === 1) switchesBeforeStarvedRan = i;
    }

    expect(switchesBeforeStarvedRan).toBeGreaterThan(0); // it really was starved for a while
    expect(switchesBeforeStarvedRan).toBeLessThan(200); // but not forever
  });
});

describe('concurrency', () => {
  test('agents blocked on inference overlap rather than serialize', async () => {
    const probe = new ConcurrencyProbeProvider(25);
    const { kernel } = makeKernel({ llm: probe });

    // swarm spawns N agents that each block on infer.
    kernel.spawn('swarm', { argv: ['swarm', '--n', '4', 'a shared question'], tty: false });

    const started = Date.now();
    await kernel.boot();
    const elapsed = Date.now() - started;

    expect(probe.calls).toBe(4);
    // The point of the design: all four were in flight at the same time.
    expect(probe.maxInFlight).toBe(4);
    // Serialized, four 25ms calls would take >=100ms.
    expect(elapsed).toBeLessThan(90);
  });

  test('one blocked process does not stop others from running', async () => {
    const order: string[] = [];
    const { kernel } = makeKernel({
      programs: [
        {
          name: 'slow',
          description: '',
          *main() {
            order.push('slow:start');
            yield sys.sleep(30);
            order.push('slow:end');
            return 0;
          },
        },
        {
          name: 'quick',
          description: '',
          *main() {
            order.push('quick:start');
            order.push('quick:end');
            return 0;
          },
        },
      ],
    });

    kernel.spawn('slow', { tty: false });
    kernel.spawn('quick', { tty: false });
    await kernel.boot();

    // quick must finish entirely while slow is still parked on its sleep.
    expect(order).toEqual(['slow:start', 'quick:start', 'quick:end', 'slow:end']);
  });
});

describe('syscall errors', () => {
  test('a failing syscall throws inside the program and is catchable', async () => {
    const { kernel } = makeKernel({
      programs: [{
        name: 'reader',
        description: '',
        *main() {
          try {
            yield sys.readFile('/nope/missing.txt');
            yield sys.print('unexpected success');
          } catch (err) {
            yield sys.print(`caught: ${(err as Error).message}`);
          }
          return 0;
        },
      }],
    });
    const proc = kernel.spawn('reader', { tty: false });
    await kernel.boot();
    expect(proc.stdout).toContain('caught: no such file or directory');
    expect(proc.exitCode).toBe(0);
  });

  test('spawning an unknown program reports command not found', async () => {
    const { kernel } = makeKernel({
      programs: [{
        name: 'launcher',
        description: '',
        *main() {
          try {
            yield sys.spawn('does-not-exist');
          } catch (err) {
            yield sys.print((err as Error).message);
          }
          return 0;
        },
      }],
    });
    const proc = kernel.spawn('launcher', { tty: false });
    await kernel.boot();
    expect(proc.stdout).toContain('command not found: does-not-exist');
  });

  test('an inference failure surfaces as a non-zero agent exit', async () => {
    const { kernel } = makeKernel({ llm: new FailingProvider() });
    const proc = kernel.spawn('agent', { argv: ['agent', 'anything'], tty: false });
    await kernel.boot();
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr).toContain('backend unavailable');
  });

  test('halt is refused for any process other than pid 1', async () => {
    const { kernel } = makeKernel({
      programs: [{
        name: 'usurper',
        description: '',
        *main() {
          try {
            yield sys.halt();
            yield sys.print('halted');
          } catch (err) {
            yield sys.print(`denied: ${(err as Error).message}`);
          }
          return 0;
        },
      }],
    });
    // Burn pid 1 so the test process is not privileged.
    kernel.register(noop);
    kernel.spawn('noop');
    const proc = kernel.spawn('usurper', { tty: false });
    await kernel.boot();
    expect(proc.stdout).toContain('denied');
  });
});
