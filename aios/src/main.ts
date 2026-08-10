#!/usr/bin/env bun
import { boot } from './boot.ts';
import { TerminalConsole, ScriptedConsole } from './kernel/console.ts';

/**
 * AIOS entry point.
 *
 *   aios                       boot into the interactive shell
 *   aios run "<cmd>" [...]     run commands non-interactively, then halt
 *   aios help                  usage
 */
async function main(argv: string[]): Promise<number> {
  const [mode = 'shell', ...rest] = argv;

  switch (mode) {
    case 'shell':
    case 'boot': {
      const console_ = new TerminalConsole();
      try {
        const kernel = await boot({ console: console_ });
        return kernel.processList().length === 0 ? 0 : 0;
      } finally {
        console_.close();
      }
    }

    case 'run': {
      if (rest.length === 0) {
        process.stderr.write('aios run: expected at least one command\n');
        return 2;
      }
      // `exit` guarantees the shell terminates even if a command misbehaves.
      const console_ = new ScriptedConsole([...rest, 'exit'], true);
      await boot({ console: console_, env: { AIOS_QUIET: '1' } });
      return 0;
    }

    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(USAGE);
      return 0;

    default:
      process.stderr.write(`aios: unknown mode: ${mode}\n\n${USAGE}`);
      return 2;
  }
}

const USAGE = `AIOS 0.1.0 — an operating system where AI agents are processes

usage:
  aios                      boot into the interactive shell
  aios run "<cmd>" [...]    run commands non-interactively, then halt
  aios help                 show this message

environment:
  ANTHROPIC_API_KEY   use the real model; without it AIOS runs a deterministic
                      offline provider so every command still works
  AIOS_MODEL          model id (default claude-sonnet-4-5)

examples:
  aios run 'help' 'ps'
  aios run 'agent "explain preemptive scheduling"'
  aios run 'swarm --n 4 "name this project"'
  aios run 'pipeline "draft a launch plan" "critique that plan"'
`;

const code = await main(process.argv.slice(2));
process.exit(code);
