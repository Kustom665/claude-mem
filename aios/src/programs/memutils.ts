import { sys } from '../kernel/syscalls.ts';
import type { Program } from '../kernel/types.ts';
import type { ScoredEntry } from '../kernel/memory.ts';

/** Command-line access to the memory shared by every process. */

export const remember: Program = {
  name: 'remember',
  description: 'store a fact in shared agent memory',
  usage: 'remember [--tags a,b] <key> <value...>',
  *main(ctx) {
    const args = ctx.argv.slice(1);
    let tags: string[] = [];

    if (args[0] === '--tags') {
      tags = (args[1] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
      args.splice(0, 2);
    }

    const key = args[0];
    // Value may come inline or over a pipe.
    const inline = args.slice(1).join(' ');
    const value = inline || ((yield sys.read()) as string).trim();

    if (!key || !value) {
      yield sys.eprint('usage: remember [--tags a,b] <key> <value...>');
      return 2;
    }

    yield sys.remember(key, value, tags);
    yield sys.print(`remembered: ${key}`);
    return 0;
  },
};

export const recall: Program = {
  name: 'recall',
  description: 'search shared agent memory',
  usage: 'recall [--limit n] <query...>',
  *main(ctx) {
    const args = ctx.argv.slice(1);
    let limit = 5;

    if (args[0] === '--limit') {
      limit = Number(args[1] ?? 5);
      args.splice(0, 2);
    }

    const query = args.join(' ');
    if (!query) {
      yield sys.eprint('usage: recall [--limit n] <query...>');
      return 2;
    }

    const hits: ScoredEntry[] = yield sys.recall(query, limit);
    if (hits.length === 0) {
      yield sys.print(`no memories matching "${query}"`);
      return 1;
    }

    yield sys.print(
      hits
        .map((h) => {
          const tags = h.tags.length > 0 ? `  [${h.tags.join(', ')}]` : '';
          return `${h.score.toFixed(2)}  ${h.key}${tags}\n      ${h.value.replace(/\n/g, '\n      ')}`;
        })
        .join('\n'),
    );
    return 0;
  },
};

export const forget: Program = {
  name: 'forget',
  description: 'delete a fact from shared agent memory',
  usage: 'forget <key>',
  *main(ctx) {
    const key = ctx.argv[1];
    if (!key) {
      yield sys.eprint('usage: forget <key>');
      return 2;
    }
    const removed: boolean = yield sys.forget(key);
    yield sys.print(removed ? `forgot: ${key}` : `no such memory: ${key}`);
    return removed ? 0 : 1;
  },
};

export const memutils = [remember, recall, forget];
