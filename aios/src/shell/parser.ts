/**
 * Shell grammar.
 *
 * Supports the pieces that actually matter for driving the OS:
 *   quoting        agent "write a haiku about schedulers"
 *   pipelines      recall kernel | agent "summarize these findings"
 *   redirection    ps > /tmp/procs.txt      echo more >> /tmp/log
 *   background     cron --every 500 uname &
 *   comments       ps   # everything after an unquoted # is dropped
 */

export interface Command {
  argv: string[];
  redirect?: { path: string; append: boolean };
}

export interface Job {
  stages: Command[];
  background: boolean;
}

export class ParseError extends Error {}

/**
 * Split a line into tokens, honouring quotes and backslash escapes.
 * Operators (`|`, `>`, `>>`, `&`) come back as their own tokens.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasContent = false; // distinguishes an empty quoted string from no token

  const push = () => {
    if (current !== '' || hasContent) tokens.push(current);
    current = '';
    hasContent = false;
  };

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && i + 1 < line.length) {
        current += line[++i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }
    if (char === '\\' && i + 1 < line.length) {
      current += line[++i];
      hasContent = true;
      continue;
    }
    if (char === '#') break; // comment runs to end of line
    if (/\s/.test(char)) {
      push();
      continue;
    }
    if (char === '|' || char === '&') {
      push();
      tokens.push(char);
      continue;
    }
    if (char === '>') {
      push();
      if (line[i + 1] === '>') {
        tokens.push('>>');
        i++;
      } else {
        tokens.push('>');
      }
      continue;
    }
    current += char;
  }

  if (quote) throw new ParseError(`unterminated ${quote === '"' ? 'double' : 'single'} quote`);
  push();
  return tokens;
}

/** Parse a command line. Returns null for a blank line or a pure comment. */
export function parse(line: string): Job | null {
  const tokens = tokenize(line);
  if (tokens.length === 0) return null;

  let background = false;
  if (tokens[tokens.length - 1] === '&') {
    background = true;
    tokens.pop();
    if (tokens.length === 0) throw new ParseError('syntax error near `&`');
  }
  if (tokens.includes('&')) throw new ParseError('`&` is only allowed at the end of a line');

  const stages: Command[] = [];
  let current: Command = { argv: [] };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    if (token === '|') {
      if (current.argv.length === 0) throw new ParseError('syntax error near `|`');
      stages.push(current);
      current = { argv: [] };
      continue;
    }

    if (token === '>' || token === '>>') {
      const path = tokens[++i];
      if (!path || path === '|' || path === '>' || path === '>>') {
        throw new ParseError(`syntax error: expected a filename after \`${token}\``);
      }
      current.redirect = { path, append: token === '>>' };
      continue;
    }

    current.argv.push(token);
  }

  if (current.argv.length === 0) throw new ParseError('syntax error: incomplete pipeline');
  stages.push(current);

  // Only the final stage may redirect; anything earlier is a silent data loss bug.
  for (const stage of stages.slice(0, -1)) {
    if (stage.redirect) throw new ParseError('redirection is only allowed on the last stage of a pipeline');
  }

  return { stages, background };
}

/** Substitute `$VAR` and `${VAR}` using `lookup`. */
export function expand(token: string, lookup: (name: string) => string): string {
  return token.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, bare) =>
    lookup(braced ?? bare),
  );
}
