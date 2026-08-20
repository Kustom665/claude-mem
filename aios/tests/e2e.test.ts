import { describe, expect, test } from 'bun:test';
import { boot } from '../src/boot.ts';
import { ScriptedConsole } from '../src/kernel/console.ts';
import { MockProvider } from '../src/llm/provider.ts';
import type { Kernel } from '../src/kernel/kernel.ts';

/** Boot a full system, run commands through the shell, return everything printed. */
async function run(...commands: string[]): Promise<{ output: string; kernel: Kernel }> {
  const console_ = new ScriptedConsole([...commands, 'exit']);
  const kernel = await boot({
    console: console_,
    llm: new MockProvider(0),
    env: { AIOS_QUIET: '1' },
  });
  return { output: console_.output, kernel };
}

describe('boot', () => {
  test('the system boots, runs a command, and halts cleanly', async () => {
    const { output, kernel } = await run('uname');
    expect(output).toContain('AIOS 0.1.0');
    expect(kernel.running).toBe(false);
  });

  test('init seeds the filesystem', async () => {
    const { output } = await run('cat /etc/version', 'ls /home');
    expect(output).toContain('AIOS 0.1.0');
    expect(output).toContain('README');
    expect(output).toContain('work');
  });

  test('init and sh are present in the process table', async () => {
    const { output } = await run('ps');
    expect(output).toContain('init');
    expect(output).toContain('sh');
  });

  test('shutdown is recorded before the kernel stops', async () => {
    const { kernel } = await run('uname');
    expect(kernel.vfs.read('/var/log/shutdown')).toContain('exit');
  });
});

describe('shell behaviour', () => {
  test('pipes stdout into the next stage', async () => {
    const { output } = await run('echo alpha beta | grep beta');
    expect(output).toContain('alpha beta');
  });

  // Note: ScriptedConsole echoes each input line into `output`, so assertions
  // about what a command *printed* are made against the filesystem instead.
  test('a pipeline stage that matches nothing yields no output', async () => {
    const { kernel } = await run('echo alpha | grep zzzz > /tmp/g.txt');
    expect(kernel.vfs.read('/tmp/g.txt')).toBe('');
  });

  test('redirection writes to a file instead of the terminal', async () => {
    const { kernel } = await run('echo written-to-disk > /tmp/out.txt');
    expect(kernel.vfs.read('/tmp/out.txt').trim()).toBe('written-to-disk');
  });

  test('append redirection accumulates', async () => {
    const { output } = await run(
      'echo one > /tmp/log',
      'echo two >> /tmp/log',
      'cat /tmp/log',
    );
    expect(output).toContain('one');
    expect(output).toContain('two');
  });

  test('cd changes the working directory and pwd reports it', async () => {
    const { output } = await run('cd /tmp', 'pwd');
    expect(output).toContain('/tmp');
  });

  test('cd into a missing directory reports an error', async () => {
    const { output } = await run('cd /does/not/exist');
    expect(output).toContain('no such file or directory');
  });

  test('exported variables expand and are inherited by children', async () => {
    const { output } = await run('export TOPIC=schedulers', 'echo topic is $TOPIC');
    expect(output).toContain('topic is schedulers');
  });

  test('$? holds the previous exit status', async () => {
    const { output } = await run('grep zzz /etc/version', 'echo status=$?');
    expect(output).toContain('status=1');
  });

  test('an unknown command reports command not found', async () => {
    const { output } = await run('nosuchprogram');
    expect(output).toContain('command not found: nosuchprogram');
  });

  test('a syntax error is reported without killing the shell', async () => {
    const { output } = await run('ps |', 'uname');
    expect(output).toContain('syntax error');
    expect(output).toContain('AIOS 0.1.0'); // shell survived and ran the next command
  });

  test('quoted arguments reach the program intact', async () => {
    const { output } = await run('echo "one   spaced   argument"');
    expect(output).toContain('one   spaced   argument');
  });
});

describe('/proc reflects live kernel state', () => {
  test('process status is generated on read', async () => {
    const { output } = await run('cat /proc/1/status');
    expect(output).toContain('Name:\tinit');
    expect(output).toContain('Pid:\t1');
  });

  test('sysinfo reports the active inference backend', async () => {
    const { output } = await run('cat /proc/sysinfo');
    expect(output).toContain('"provider": "mock"');
  });

  test('listing /proc includes a directory per live process', async () => {
    const { output } = await run('ls /proc');
    expect(output).toContain('sysinfo');
    expect(output).toContain('1'); // init
  });

  test('/proc is read-only', async () => {
    const { output } = await run('write /proc/hack nope');
    expect(output).toContain('permission denied');
  });
});

describe('agents', () => {
  test('an agent produces output and records it in shared memory', async () => {
    const { output } = await run('agent --quiet "explain preemptive scheduling"', 'recall scheduling');
    expect(output).toContain('[mock]');
    // recall found the agent's own stored finding
    expect(output).toContain('agent-output');
  });

  test('memory written by one command is visible to the next', async () => {
    const { output } = await run(
      'remember --tags kernel deadline "ship on friday"',
      'recall deadline',
    );
    expect(output).toContain('remembered: deadline');
    expect(output).toContain('ship on friday');
  });

  test('forget removes a memory', async () => {
    const { output } = await run(
      'remember k some value here',
      'forget k',
      'recall k',
    );
    expect(output).toContain('forgot: k');
    expect(output).toContain('no memories matching');
  });

  test('swarm runs several agents and labels each result', async () => {
    const { output } = await run('swarm --n 3 "name this project"');
    expect(output).toContain('3 agents running concurrently');
    expect(output).toContain('agent 1');
    expect(output).toContain('agent 3');
  });

  test('pipeline feeds each stage into the next', async () => {
    const { output } = await run('pipeline --quiet "draft a plan" "critique that plan"');
    expect(output).toContain('[mock]');
  });

  test('agent reads its task from a pipe', async () => {
    const { output } = await run('echo "summarize this text" | agent --quiet');
    expect(output).toContain('[mock]');
  });
});

describe('jobs and daemons', () => {
  test('a background job reports its id and does not block the shell', async () => {
    const { output } = await run('cron --every 5 --count 2 uname &', 'sleep 60', 'jobs');
    expect(output).toMatch(/\[1\] \d+/);
    expect(output).toContain('cron[1]');
  });

  test('jobs reports nothing when none are running', async () => {
    const { output } = await run('jobs');
    expect(output).toContain('no background jobs');
  });

  test('cron shuts down cleanly on SIGTERM', async () => {
    // Boot order is deterministic: init=1, sh=2, so the backgrounded cron is 3.
    const { output } = await run(
      'cron --every 40 --forever uname &',
      'sleep 20',
      'kill -TERM 3',
      'sleep 80',
    );
    expect(output).toContain('caught SIGTERM');
  });

  test('killing a nonexistent process reports an error', async () => {
    const { output } = await run('kill 9999');
    expect(output).toContain('no such process');
  });
});
