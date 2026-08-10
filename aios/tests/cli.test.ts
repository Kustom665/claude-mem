import { describe, expect, test } from 'bun:test';

/**
 * Integration tests that drive the real CLI as a subprocess, exercising the
 * terminal console rather than the scripted one used elsewhere.
 */
const ENTRY = new URL('../src/main.ts', import.meta.url).pathname;

async function runCli(args: string[], stdin?: string): Promise<{ stdout: string; code: number }> {
  const proc = Bun.spawn(['bun', 'run', ENTRY, ...args], {
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { stdout, code };
}

describe('cli', () => {
  test('every piped line is executed, not just the first', async () => {
    // Regression: readline emits `line` events as input arrives, so a console
    // that only reads on demand silently dropped every line after the first.
    const { stdout } = await runCli(['shell'], 'uname\npwd\necho third-command-ran\nexit\n');

    expect(stdout).toContain('AIOS 0.1.0'); // uname
    expect(stdout).toContain('/home'); // pwd
    expect(stdout).toContain('third-command-ran'); // echo
  }, 30_000);

  test('run mode executes each command and halts', async () => {
    const { stdout, code } = await runCli(['run', 'echo one', 'echo two']);
    expect(stdout).toContain('one');
    expect(stdout).toContain('two');
    expect(code).toBe(0);
  }, 30_000);

  test('help is printed for the help mode', async () => {
    const { stdout, code } = await runCli(['help']);
    expect(stdout).toContain('agents are processes');
    expect(code).toBe(0);
  }, 30_000);

  test('an unknown mode exits non-zero', async () => {
    const { code } = await runCli(['nonsense-mode']);
    expect(code).toBe(2);
  }, 30_000);

  test('EOF without an explicit exit still shuts down cleanly', async () => {
    const { stdout, code } = await runCli(['shell'], 'uname\n');
    expect(stdout).toContain('logout');
    expect(code).toBe(0);
  }, 30_000);
});
