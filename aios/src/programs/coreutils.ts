import { sys, FD } from '../kernel/syscalls.ts';
import type { Program } from '../kernel/types.ts';

/** Filesystem and text utilities — AIOS's /bin staples. */

export const echo: Program = {
  name: 'echo',
  description: 'print arguments to stdout',
  usage: 'echo [text...]',
  *main(ctx) {
    yield sys.print(ctx.argv.slice(1).join(' '));
    return 0;
  },
};

export const cat: Program = {
  name: 'cat',
  description: 'print files, or stdin when given no arguments',
  usage: 'cat [file...]',
  *main(ctx) {
    const paths = ctx.argv.slice(1);
    if (paths.length === 0) {
      const input: string = yield sys.read();
      yield sys.write(FD.STDOUT, input);
      return 0;
    }
    let status = 0;
    for (const path of paths) {
      try {
        const content: string = yield sys.readFile(path);
        yield sys.write(FD.STDOUT, content.endsWith('\n') || content === '' ? content : `${content}\n`);
      } catch (err) {
        yield sys.eprint(`cat: ${(err as Error).message}`);
        status = 1;
      }
    }
    return status;
  },
};

export const ls: Program = {
  name: 'ls',
  description: 'list directory contents',
  usage: 'ls [-l] [path]',
  *main(ctx) {
    const args = ctx.argv.slice(1);
    const long = args.includes('-l');
    const path = args.find((a) => !a.startsWith('-')) ?? '.';

    try {
      const stat: { type: string } = yield sys.stat(path);
      if (stat.type === 'file') {
        yield sys.print(path);
        return 0;
      }
      const names: string[] = yield sys.listdir(path);
      if (!long) {
        if (names.length > 0) yield sys.print(names.join('  '));
        return 0;
      }
      for (const name of names) {
        const child = path === '.' ? name : `${path.replace(/\/$/, '')}/${name}`;
        const info: { type: string; size: number } = yield sys.stat(child);
        const kind = info.type === 'dir' ? 'd' : '-';
        yield sys.print(`${kind} ${String(info.size).padStart(8)}  ${name}`);
      }
      return 0;
    } catch (err) {
      yield sys.eprint(`ls: ${(err as Error).message}`);
      return 1;
    }
  },
};

export const write: Program = {
  name: 'write',
  description: 'write text to a file (use -a to append)',
  usage: 'write [-a] <file> <text...>',
  *main(ctx) {
    const args = ctx.argv.slice(1);
    const append = args[0] === '-a';
    const rest = append ? args.slice(1) : args;
    const path = rest[0];
    if (!path) {
      yield sys.eprint('usage: write [-a] <file> <text...>');
      return 2;
    }
    // With no inline text, take the body from stdin so `x | write f` works.
    const inline = rest.slice(1).join(' ');
    const body: string = inline || ((yield sys.read()) as string);
    try {
      yield append ? sys.appendFile(path, `${body}\n`) : sys.writeFile(path, `${body}\n`);
      return 0;
    } catch (err) {
      yield sys.eprint(`write: ${(err as Error).message}`);
      return 1;
    }
  },
};

export const mkdir: Program = {
  name: 'mkdir',
  description: 'create a directory, including missing parents',
  usage: 'mkdir <path...>',
  *main(ctx) {
    const paths = ctx.argv.slice(1);
    if (paths.length === 0) {
      yield sys.eprint('usage: mkdir <path...>');
      return 2;
    }
    for (const path of paths) {
      try {
        yield sys.mkdir(path);
      } catch (err) {
        yield sys.eprint(`mkdir: ${(err as Error).message}`);
        return 1;
      }
    }
    return 0;
  },
};

export const rm: Program = {
  name: 'rm',
  description: 'remove a file or directory',
  usage: 'rm <path...>',
  *main(ctx) {
    const paths = ctx.argv.slice(1);
    if (paths.length === 0) {
      yield sys.eprint('usage: rm <path...>');
      return 2;
    }
    let status = 0;
    for (const path of paths) {
      try {
        yield sys.unlink(path);
      } catch (err) {
        yield sys.eprint(`rm: ${(err as Error).message}`);
        status = 1;
      }
    }
    return status;
  },
};

export const pwd: Program = {
  name: 'pwd',
  description: 'print the working directory',
  *main() {
    const dir: string = yield sys.cwd();
    yield sys.print(dir);
    return 0;
  },
};

export const grep: Program = {
  name: 'grep',
  description: 'print stdin lines matching a pattern',
  usage: 'grep <pattern> [file]',
  *main(ctx) {
    const [, pattern, file] = ctx.argv;
    if (!pattern) {
      yield sys.eprint('usage: grep <pattern> [file]');
      return 2;
    }
    let text: string;
    try {
      text = file ? ((yield sys.readFile(file)) as string) : ((yield sys.read()) as string);
    } catch (err) {
      yield sys.eprint(`grep: ${(err as Error).message}`);
      return 1;
    }
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      yield sys.eprint(`grep: invalid pattern: ${pattern}`);
      return 2;
    }
    const hits = text.split('\n').filter((line) => re.test(line));
    if (hits.length > 0) yield sys.print(hits.join('\n'));
    return hits.length > 0 ? 0 : 1;
  },
};

export const sleep: Program = {
  name: 'sleep',
  description: 'block for a number of milliseconds',
  usage: 'sleep <ms>',
  *main(ctx) {
    const ms = Number(ctx.argv[1] ?? 0);
    if (!Number.isFinite(ms) || ms < 0) {
      yield sys.eprint('usage: sleep <ms>');
      return 2;
    }
    yield sys.sleep(ms);
    return 0;
  },
};

export const coreutils = [echo, cat, ls, write, mkdir, rm, pwd, grep, sleep];
