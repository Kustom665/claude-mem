import { describe, expect, test } from 'bun:test';
import { tokenize, parse, expand, ParseError } from '../src/shell/parser.ts';

describe('tokenizer', () => {
  test('splits on whitespace', () => {
    expect(tokenize('ps aux now')).toEqual(['ps', 'aux', 'now']);
  });

  test('keeps quoted strings together', () => {
    expect(tokenize('agent "explain the scheduler"')).toEqual(['agent', 'explain the scheduler']);
    expect(tokenize("agent 'single quoted'")).toEqual(['agent', 'single quoted']);
  });

  test('preserves an empty quoted argument', () => {
    expect(tokenize('write f ""')).toEqual(['write', 'f', '']);
  });

  test('single quotes are literal, double quotes honour escapes', () => {
    expect(tokenize(`echo 'a\\nb'`)).toEqual(['echo', 'a\\nb']);
    expect(tokenize(`echo "say \\"hi\\""`)).toEqual(['echo', 'say "hi"']);
  });

  test('operators become their own tokens even without spaces', () => {
    expect(tokenize('ps|grep sh')).toEqual(['ps', '|', 'grep', 'sh']);
    expect(tokenize('ps>/tmp/p')).toEqual(['ps', '>', '/tmp/p']);
    expect(tokenize('ps>>/tmp/p')).toEqual(['ps', '>>', '/tmp/p']);
  });

  test('comments are stripped, but not inside quotes', () => {
    expect(tokenize('ps # show processes')).toEqual(['ps']);
    expect(tokenize('echo "a # b"')).toEqual(['echo', 'a # b']);
  });

  test('an unterminated quote is a parse error', () => {
    expect(() => tokenize('agent "unfinished')).toThrow(ParseError);
  });
});

describe('parser', () => {
  test('a blank line or bare comment parses to nothing', () => {
    expect(parse('')).toBeNull();
    expect(parse('   ')).toBeNull();
    expect(parse('# just a comment')).toBeNull();
  });

  test('simple command', () => {
    expect(parse('ls -l /tmp')).toEqual({
      stages: [{ argv: ['ls', '-l', '/tmp'] }],
      background: false,
    });
  });

  test('pipelines split into stages', () => {
    const job = parse('ps | grep sh | cat')!;
    expect(job.stages.map((s) => s.argv[0])).toEqual(['ps', 'grep', 'cat']);
  });

  test('redirection attaches to the final stage', () => {
    const job = parse('ps | grep sh > /tmp/out')!;
    expect(job.stages).toHaveLength(2);
    expect(job.stages[1]!.redirect).toEqual({ path: '/tmp/out', append: false });
  });

  test('append redirection is distinguished', () => {
    expect(parse('echo hi >> /tmp/log')!.stages[0]!.redirect).toEqual({
      path: '/tmp/log',
      append: true,
    });
  });

  test('trailing ampersand marks the job as background', () => {
    const job = parse('cron --every 500 uname &')!;
    expect(job.background).toBe(true);
    expect(job.stages[0]!.argv).toEqual(['cron', '--every', '500', 'uname']);
  });

  test('syntax errors are rejected rather than silently accepted', () => {
    expect(() => parse('| grep x')).toThrow(ParseError);
    expect(() => parse('ps |')).toThrow(ParseError);
    expect(() => parse('ps >')).toThrow(ParseError);
    expect(() => parse('ps & grep x')).toThrow(ParseError);
    // Redirecting a non-final stage would discard its output silently.
    expect(() => parse('ps > /tmp/a | grep x')).toThrow(ParseError);
  });
});

describe('variable expansion', () => {
  const env: Record<string, string> = { USER: 'operator', HOME: '/home' };
  const lookup = (name: string) => env[name] ?? '';

  test('expands bare and braced forms', () => {
    expect(expand('$USER', lookup)).toBe('operator');
    expect(expand('${HOME}/work', lookup)).toBe('/home/work');
  });

  test('unset variables expand to empty', () => {
    expect(expand('[$NOPE]', lookup)).toBe('[]');
  });

  test('leaves non-variable text alone', () => {
    expect(expand('costs $ and more', lookup)).toBe('costs $ and more');
  });
});
