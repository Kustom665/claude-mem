/**
 * The console device.
 *
 * Abstracted so the kernel does not care whether it is attached to a terminal,
 * a test script, or a websocket. `readLine` resolving to null means EOF, which
 * the shell treats as a request to log out.
 */
export interface ConsoleDevice {
  write(data: string): void;
  readLine(prompt: string): Promise<string | null>;
  close(): void;
}

/**
 * Console backed by the real terminal.
 *
 * Lines are buffered as they arrive rather than read on demand. Node's readline
 * emits `line` events the moment input is available, so asking for a line only
 * when a process happens to want one drops everything that arrived in between —
 * which breaks piped input (`printf 'a\nb\n' | aios`) entirely.
 */
export class TerminalConsole implements ConsoleDevice {
  private rl: import('node:readline').Interface | null = null;
  private readonly buffered: string[] = [];
  private readonly waiters: Array<(line: string | null) => void> = [];
  private ended = false;

  write(data: string): void {
    process.stdout.write(data);
  }

  async readLine(prompt: string): Promise<string | null> {
    await this.ensureInterface();
    process.stdout.write(prompt);

    const queued = this.buffered.shift();
    if (queued !== undefined) return queued;
    if (this.ended) return null;

    return new Promise<string | null>((resolve) => this.waiters.push(resolve));
  }

  private async ensureInterface(): Promise<void> {
    if (this.rl || this.ended) return;

    const readline = await import('node:readline');
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY ?? false,
    });

    this.rl.on('line', (line: string) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.buffered.push(line);
    });
    this.rl.on('close', () => this.end());
    // Ctrl-C at the prompt ends the session rather than killing the process
    // mid-syscall and leaving the terminal in a strange state.
    this.rl.on('SIGINT', () => this.close());
  }

  /** Mark EOF and release anything still waiting for a line. */
  private end(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  close(): void {
    if (this.ended && !this.rl) return;
    this.rl?.close();
    this.rl = null;
    this.end();
  }
}

/**
 * Console driven by a fixed script of input lines, capturing all output.
 * Used by tests and by `aios run`.
 */
export class ScriptedConsole implements ConsoleDevice {
  output = '';
  private index = 0;

  /**
   * @param lines   input lines fed to successive `readLine` calls
   * @param echo    also write through to the real stdout (used by `aios run`)
   */
  constructor(
    private readonly lines: string[],
    private readonly echo = false,
  ) {}

  write(data: string): void {
    this.output += data;
    if (this.echo) process.stdout.write(data);
  }

  async readLine(prompt: string): Promise<string | null> {
    this.output += prompt;
    if (this.index >= this.lines.length) return null;
    const line = this.lines[this.index++]!;
    this.output += `${line}\n`;
    return line;
  }

  close(): void {
    this.index = this.lines.length;
  }
}
