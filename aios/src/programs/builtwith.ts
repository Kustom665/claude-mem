import { sys } from '../kernel/syscalls.ts';
import type { Program } from '../kernel/types.ts';

/**
 * BuiltWith live-feed daemon.
 *
 * Subscribes to the BuiltWith WebSocket feed and records each technology
 * detection into AIOS shared memory, so an agent can qualify the leads that
 * arrive without the feed and the agent knowing about each other.
 *
 * The API key is read from the environment and never printed. The connection
 * URL carries the key in its query string, so this program logs only the host.
 *
 * On shutdown: this daemon deliberately does *not* catch SIGTERM. It spends
 * nearly all its time blocked in `sockRecv`, and a caught signal would not be
 * observed until the next frame arrived — which for a quiet channel could be
 * minutes. Letting the kernel terminate it is prompt, and the kernel closes the
 * socket as part of process teardown.
 */

const FEED_HOST = 'wss://sync.builtwith.com';
const DEFAULT_CHANNEL = 'Shopify';
const MAX_BACKOFF_MS = 30_000;

interface FeedMessage {
  type?: string;
  channel?: string;
  message?: string;
  view_mode?: string;
  data?: { channel_name?: string; website_domain?: string; epoch_secs?: number };
}

export const builtwith: Program = {
  name: 'builtwith',
  description: 'stream the BuiltWith live technology feed into shared memory',
  usage: 'builtwith [--channel <tech>]... [--limit <n>] [--out <file>] [--retries <n>] [--backoff <ms>] [--quiet]',
  *main(ctx) {
    const opts = parseOptions(ctx.argv);
    if (opts.error) {
      yield sys.eprint(`builtwith: ${opts.error}`);
      return 2;
    }

    const key: string = yield sys.getenv('BUILTWITH_API_KEY');
    if (!key) {
      yield sys.eprint('builtwith: BUILTWITH_API_KEY is not set');
      yield sys.eprint('  export BUILTWITH_API_KEY=<your key>   # never commit this');
      return 78; // EX_CONFIG
    }

    const channels = opts.channels.length > 0 ? opts.channels : [DEFAULT_CHANNEL];
    let detections = 0;
    let attempt = 0;

    while (true) {
      let fd: number;
      try {
        // The key rides in the query string, so this URL must never be logged.
        fd = yield sys.connect(`${FEED_HOST}/wss/new?KEY=${encodeURIComponent(key)}`);
      } catch (err) {
        attempt++;
        if (attempt > opts.retries) {
          yield sys.eprint(`builtwith: ${(err as Error).message}; giving up after ${attempt} attempt(s)`);
          return 1;
        }
        const backoff = backoffMs(attempt, opts.backoffMs);
        yield sys.eprint(`builtwith: ${(err as Error).message}; retrying in ${backoff}ms`);
        yield sys.sleep(backoff);
        continue;
      }

      if (!opts.quiet) {
        yield sys.print(`builtwith: connected to ${FEED_HOST} (pid ${ctx.pid})`);
      }

      for (const channel of channels) {
        yield sys.sockSend(fd, JSON.stringify({ action: 'subscribe', channel }));
      }

      const outcome = yield* readFeed(fd, opts, detections);
      detections = outcome.detections;

      // Only a session that actually produced something counts as healthy.
      // Resetting on a bare successful connect would let a peer that accepts
      // and immediately closes spin this loop forever.
      if (outcome.sessionDetections > 0) attempt = 0;

      if (outcome.done) {
        try {
          yield sys.sockClose(fd);
        } catch {
          /* already closed by the peer */
        }
        if (!opts.quiet) yield sys.print(`builtwith: recorded ${detections} detection(s)`);
        return 0;
      }

      // Peer closed. Reconnect unless we have exhausted our retries.
      attempt++;
      if (attempt > opts.retries) {
        yield sys.eprint(`builtwith: feed closed; giving up after ${attempt} reconnect(s)`);
        return 1;
      }
      const backoff = backoffMs(attempt, opts.backoffMs);
      if (!opts.quiet) yield sys.eprint(`builtwith: feed closed; reconnecting in ${backoff}ms`);
      yield sys.sleep(backoff);
    }
  },
};

interface Options {
  channels: string[];
  limit: number;
  out: string | null;
  retries: number;
  /** First backoff step; each subsequent attempt doubles it. */
  backoffMs: number;
  quiet: boolean;
  error?: string;
}

/** Consume frames until the limit is hit or the peer closes. */
function* readFeed(
  fd: number,
  opts: Options,
  startingCount: number,
): Generator<any, { done: boolean; detections: number; sessionDetections: number }, any> {
  let detections = startingCount;
  let sessionDetections = 0;

  while (true) {
    const frame: string | null = yield sys.sockRecv(fd);
    if (frame === null) return { done: false, detections, sessionDetections }; // peer closed

    let msg: FeedMessage;
    try {
      msg = JSON.parse(frame) as FeedMessage;
    } catch {
      // A malformed frame is the server's problem, not a reason to die.
      yield sys.eprint('builtwith: ignoring unparseable frame');
      continue;
    }

    switch (msg.type) {
      case 'connected':
        if (!opts.quiet && msg.view_mode) {
          yield sys.print(`builtwith: view mode ${msg.view_mode}`);
          if (msg.view_mode !== 'full') {
            yield sys.eprint('builtwith: domains are redacted on this plan');
          }
        }
        break;

      case 'subscribed':
        if (!opts.quiet) yield sys.print(`builtwith: subscribed to ${msg.channel}`);
        break;

      case 'status_change':
        yield sys.print(`builtwith: ${msg.message ?? 'subscription changed'}`);
        break;

      case 'error':
        // Server-side errors are per-command, so keep the connection.
        yield sys.eprint(`builtwith: server error: ${msg.message ?? 'unknown'}`);
        break;

      case 'message': {
        const domain = msg.data?.website_domain;
        const tech = msg.data?.channel_name ?? msg.channel ?? 'unknown';
        if (!domain) {
          yield sys.eprint('builtwith: detection with no domain, skipped');
          break;
        }

        detections++;
        sessionDetections++;
        const seen = msg.data?.epoch_secs
          ? new Date(msg.data.epoch_secs * 1000).toISOString()
          : 'unknown time';

        yield sys.print(`${tech}\t${domain}\t${seen}`);

        // Publish to shared memory so agents can pick it up by tag or tech.
        yield sys.remember(
          `lead-${domain}`,
          `${domain} was detected running ${tech} at ${seen}`,
          ['builtwith', 'lead', slug(tech)],
        );

        if (opts.out) {
          try {
            yield sys.appendFile(opts.out, `${domain},${tech},${seen}\n`);
          } catch (err) {
            yield sys.eprint(`builtwith: cannot write ${opts.out}: ${(err as Error).message}`);
          }
        }

        if (opts.limit > 0 && detections >= opts.limit) return { done: true, detections, sessionDetections };
        break;
      }

      default:
        // 'info' and anything the API adds later: ignore rather than fail.
        break;
    }
  }
}

/** Exponential backoff from a configurable base, capped. */
function backoffMs(attempt: number, baseMs: number): number {
  return Math.min(MAX_BACKOFF_MS, baseMs * 2 ** (attempt - 1));
}

function parseOptions(argv: readonly string[]): Options {
  const opts: Options = { channels: [], limit: 0, out: null, retries: 5, backoffMs: 1000, quiet: false };

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--quiet':
        opts.quiet = true;
        break;
      case '--channel': {
        const value = argv[++i];
        if (!value) return { ...opts, error: '--channel requires a technology name' };
        opts.channels.push(value);
        break;
      }
      case '--limit': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value < 0) return { ...opts, error: '--limit requires a non-negative integer' };
        opts.limit = value;
        break;
      }
      case '--retries': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value < 0) return { ...opts, error: '--retries requires a non-negative integer' };
        opts.retries = value;
        break;
      }
      case '--out': {
        const value = argv[++i];
        if (!value) return { ...opts, error: '--out requires a path' };
        opts.out = value;
        break;
      }
      case '--backoff': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value < 0) return { ...opts, error: '--backoff requires a non-negative integer' };
        opts.backoffMs = value;
        break;
      }
      default:
        return { ...opts, error: `unknown option: ${arg}` };
    }
  }
  return opts;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}
