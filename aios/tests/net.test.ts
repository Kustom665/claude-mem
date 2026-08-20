import { describe, expect, test } from 'bun:test';
import { sys } from '../src/kernel/syscalls.ts';
import { FakeNetwork, WebSocketNetwork, redactUrl } from '../src/kernel/net.ts';
import { makeKernel } from './helpers.ts';
import type { Program } from '../src/kernel/types.ts';

/** Frames shaped like the documented BuiltWith server messages. */
const connected = JSON.stringify({ type: 'connected', view_mode: 'full' });
const subscribed = (channel: string) => JSON.stringify({ type: 'subscribed', channel });
const detection = (domain: string, tech = 'Shopify', epoch = 1770508800) =>
  JSON.stringify({ type: 'message', channel: tech, data: { channel_name: tech, website_domain: domain, epoch_secs: epoch } });

const KEY = 'test-key-not-a-real-credential';

function feedKernel(script: string[][], argv: string[], env: Record<string, string> = {}) {
  const net = new FakeNetwork(script);
  const { kernel } = makeKernel({ net });
  const proc = kernel.spawn('builtwith', {
    argv,
    tty: false,
    env: { BUILTWITH_API_KEY: KEY, ...env },
  });
  return { kernel, net, proc };
}

describe('socket syscalls', () => {
  test('connect returns a descriptor above the stdio range', async () => {
    const net = new FakeNetwork([[]]);
    const { kernel } = makeKernel({
      net,
      programs: [{
        name: 'dialer',
        description: '',
        *main() {
          const fd: number = yield sys.connect('wss://example.test/feed');
          yield sys.print(`fd=${fd}`);
          return 0;
        },
      }],
    });
    const proc = kernel.spawn('dialer', { tty: false });
    await kernel.boot();

    expect(proc.stdout.trim()).toBe('fd=3'); // 0,1,2 reserved for stdio
    expect(net.connections).toEqual(['wss://example.test/feed']);
  });

  test('frames are buffered, then recv reports close with null', async () => {
    const net = new FakeNetwork([['one', 'two']]);
    const { kernel } = makeKernel({
      net,
      programs: [{
        name: 'reader',
        description: '',
        *main() {
          const fd: number = yield sys.connect('wss://example.test');
          // Deliberately sleep first: the frames arrive while nothing is
          // reading, so this only works because the socket buffers them.
          yield sys.sleep(5);
          const a = yield sys.sockRecv(fd);
          const b = yield sys.sockRecv(fd);
          const c = yield sys.sockRecv(fd);
          yield sys.print(`${a},${b},${c}`);
          return 0;
        },
      }],
    });
    const proc = kernel.spawn('reader', { tty: false });
    await kernel.boot();

    expect(proc.stdout.trim()).toBe('one,two,null');
  });

  test('sent frames reach the socket', async () => {
    const net = new FakeNetwork([[]]);
    const { kernel } = makeKernel({
      net,
      programs: [{
        name: 'talker',
        description: '',
        *main() {
          const fd: number = yield sys.connect('wss://example.test');
          yield sys.sockSend(fd, 'hello');
          return 0;
        },
      }],
    });
    kernel.spawn('talker', { tty: false });
    await kernel.boot();

    expect(net.sockets[0]!.sent).toEqual(['hello']);
  });

  test('a descriptor cannot be used by a process that does not own it', async () => {
    const net = new FakeNetwork([[]]);
    const { kernel } = makeKernel({
      net,
      programs: [
        {
          name: 'thief',
          description: '',
          *main() {
            try {
              yield sys.sockSend(3, 'not mine');
              yield sys.print('unexpected success');
            } catch (err) {
              yield sys.print(`denied: ${(err as Error).message}`);
            }
            return 0;
          },
        },
        {
          name: 'owner',
          description: '',
          *main() {
            yield sys.connect('wss://example.test'); // takes fd 3
            const pid: number = yield sys.spawn('thief', { tty: false });
            yield sys.wait(pid);
            return 0;
          },
        },
      ],
    });
    const owner = kernel.spawn('owner', { tty: false });
    await kernel.boot();

    const thief = [...kernel.processes.values()].find((p) => p.name === 'thief');
    expect(owner.exitCode).toBe(0);
    // The child's output is captured; assert via the fake socket staying clean.
    expect(net.sockets[0]!.sent).toEqual([]);
    expect(thief).toBeUndefined(); // reaped by wait
  });

  test('sockets are closed when their owner exits', async () => {
    const net = new FakeNetwork([[]]);
    const { kernel } = makeKernel({
      net,
      programs: [{
        name: 'leaker',
        description: '',
        *main() {
          yield sys.connect('wss://example.test');
          return 0; // exits without closing
        },
      }],
    });
    kernel.spawn('leaker', { tty: false });
    await kernel.boot();

    expect(net.sockets[0]!.closed).toBe(true);
    expect(kernel.sysinfo().openSockets).toBe(0);
  });

  test('a failed connection surfaces as a catchable error', async () => {
    const net = new FakeNetwork([[]], /example\.test/);
    const { kernel } = makeKernel({
      net,
      programs: [{
        name: 'dialer',
        description: '',
        *main() {
          try {
            yield sys.connect('wss://example.test');
            yield sys.print('unexpected success');
          } catch (err) {
            yield sys.print(`failed: ${(err as Error).message}`);
          }
          return 0;
        },
      }],
    });
    const proc = kernel.spawn('dialer', { tty: false });
    await kernel.boot();

    expect(proc.stdout).toContain('failed: connection to wss://example.test failed');
  });

  test('the real network rejects non-websocket protocols', async () => {
    await expect(new WebSocketNetwork().connect('https://example.test')).rejects.toThrow(
      'unsupported protocol: https',
    );
  });
});

describe('url redaction', () => {
  test('query strings are stripped so keys cannot leak into logs', () => {
    expect(redactUrl('wss://sync.builtwith.com/wss/new?KEY=secret-value')).toBe(
      'wss://sync.builtwith.com/wss/new?<redacted>',
    );
    expect(redactUrl('wss://sync.builtwith.com/wss/new')).toBe('wss://sync.builtwith.com/wss/new');
  });
});

describe('builtwith daemon', () => {
  test('refuses to run without an API key', async () => {
    const net = new FakeNetwork([[]]);
    const { kernel } = makeKernel({ net });
    const proc = kernel.spawn('builtwith', { argv: ['builtwith'], tty: false, env: { BUILTWITH_API_KEY: '' } });
    await kernel.boot();

    expect(proc.exitCode).toBe(78);
    expect(proc.stderr).toContain('BUILTWITH_API_KEY is not set');
    expect(net.connections).toHaveLength(0); // never dialled
  });

  test('subscribes to Shopify by default', async () => {
    const { kernel, net, proc } = feedKernel(
      [[connected, subscribed('Shopify'), detection('shop.example')]],
      ['builtwith', '--limit', '1'],
    );
    await kernel.boot();

    expect(proc.exitCode).toBe(0);
    expect(net.sockets[0]!.sent).toEqual([JSON.stringify({ action: 'subscribe', channel: 'Shopify' })]);
  });

  test('subscribes to every requested channel', async () => {
    const { kernel, net } = feedKernel(
      [[connected, detection('a.example')]],
      ['builtwith', '--channel', 'Shopify', '--channel', 'new', '--limit', '1'],
    );
    await kernel.boot();

    expect(net.sockets[0]!.sent).toEqual([
      JSON.stringify({ action: 'subscribe', channel: 'Shopify' }),
      JSON.stringify({ action: 'subscribe', channel: 'new' }),
    ]);
  });

  test('records each detection into shared memory as a lead', async () => {
    const { kernel, proc } = feedKernel(
      [[connected, detection('shop.example', 'Shopify')]],
      ['builtwith', '--limit', '1', '--quiet'],
    );
    await kernel.boot();

    expect(proc.exitCode).toBe(0);
    expect(proc.stdout).toContain('shop.example');

    const lead = kernel.memory.get('lead-shop.example');
    expect(lead).toBeDefined();
    expect(lead!.value).toContain('Shopify');
    expect(lead!.tags).toEqual(['builtwith', 'lead', 'shopify']);

    // And it is findable the way an agent would look for it.
    expect(kernel.memory.recall('shopify leads', 5).length).toBeGreaterThan(0);
  });

  test('--limit stops the daemon after N detections', async () => {
    const { kernel, proc } = feedKernel(
      [[connected, detection('a.example'), detection('b.example'), detection('c.example')]],
      ['builtwith', '--limit', '2', '--quiet'],
    );
    await kernel.boot();

    expect(proc.exitCode).toBe(0);
    expect(kernel.memory.get('lead-a.example')).toBeDefined();
    expect(kernel.memory.get('lead-b.example')).toBeDefined();
    expect(kernel.memory.get('lead-c.example')).toBeUndefined(); // stopped first
  });

  test('--out appends a csv row per detection', async () => {
    const { kernel } = feedKernel(
      [[connected, detection('a.example'), detection('b.example')]],
      ['builtwith', '--limit', '2', '--quiet', '--out', '/tmp/leads.csv'],
    );
    await kernel.boot();

    const csv = kernel.vfs.read('/tmp/leads.csv').trim().split('\n');
    expect(csv).toHaveLength(2);
    expect(csv[0]).toStartWith('a.example,Shopify,');
  });

  test('the API key never appears in any output', async () => {
    const { kernel, proc } = feedKernel(
      [[connected, detection('a.example')]],
      ['builtwith', '--limit', '1'],
    );
    await kernel.boot();

    expect(proc.stdout).not.toContain(KEY);
    expect(proc.stderr).not.toContain(KEY);
  });

  test('the key is sent in the connection url, url-encoded', async () => {
    const { kernel, net } = feedKernel(
      [[connected, detection('a.example')]],
      ['builtwith', '--limit', '1'],
      { BUILTWITH_API_KEY: 'key with spaces&stuff' },
    );
    await kernel.boot();

    expect(net.connections[0]).toBe(
      'wss://sync.builtwith.com/wss/new?KEY=key%20with%20spaces%26stuff',
    );
  });

  test('a malformed frame is skipped without killing the daemon', async () => {
    const { kernel, proc } = feedKernel(
      [[connected, 'not json at all', detection('a.example')]],
      ['builtwith', '--limit', '1', '--quiet'],
    );
    await kernel.boot();

    expect(proc.exitCode).toBe(0);
    expect(proc.stderr).toContain('unparseable frame');
    expect(kernel.memory.get('lead-a.example')).toBeDefined();
  });

  test('a server error frame is reported but does not disconnect', async () => {
    const { kernel, proc } = feedKernel(
      [[
        connected,
        JSON.stringify({ type: 'error', message: "Technology 'nope' not found" }),
        detection('a.example'),
      ]],
      ['builtwith', '--limit', '1', '--quiet'],
    );
    await kernel.boot();

    expect(proc.exitCode).toBe(0);
    expect(proc.stderr).toContain("Technology 'nope' not found");
    expect(kernel.memory.get('lead-a.example')).toBeDefined();
  });

  test('a detection with no domain is skipped', async () => {
    const { kernel, proc } = feedKernel(
      [[connected, JSON.stringify({ type: 'message', data: { channel_name: 'Shopify' } }), detection('a.example')]],
      ['builtwith', '--limit', '1', '--quiet'],
    );
    await kernel.boot();

    expect(proc.stderr).toContain('detection with no domain');
    expect(proc.exitCode).toBe(0);
  });

  test('a redacted view mode is called out', async () => {
    const { kernel, proc } = feedKernel(
      [[JSON.stringify({ type: 'connected', view_mode: 'redacted (trial/preview)' }), detection('grxxt.cxm')]],
      ['builtwith', '--limit', '1'],
    );
    await kernel.boot();

    expect(proc.stderr).toContain('domains are redacted');
  });

  test('reconnects when the feed closes, then gives up after --retries', async () => {
    // First session is productive; every later one connects and immediately
    // closes, which is the case that must not spin forever.
    const { kernel, net, proc } = feedKernel(
      [[connected, detection('a.example')], []],
      ['builtwith', '--retries', '2', '--backoff', '5', '--quiet'],
    );
    await kernel.boot();

    expect(proc.exitCode).toBe(1);
    expect(proc.stderr).toContain('giving up');
    // Productive session, then two empty reconnects, then it stops.
    expect(net.connections).toHaveLength(3);
  });

  test('a productive session resets the retry budget', async () => {
    // With --retries 1 the second connection is only reachable because the
    // first session delivered a detection and reset the counter.
    const { kernel, net, proc } = feedKernel(
      [[connected, detection('a.example')], [connected, detection('b.example')]],
      ['builtwith', '--retries', '1', '--backoff', '5', '--limit', '2', '--quiet'],
    );
    await kernel.boot();

    expect(proc.exitCode).toBe(0);
    expect(net.connections).toHaveLength(2);
    expect(kernel.memory.get('lead-b.example')).toBeDefined();
  });

  test('rejects unknown options rather than ignoring them', async () => {
    const { kernel, proc } = feedKernel([[]], ['builtwith', '--bogus']);
    await kernel.boot();

    expect(proc.exitCode).toBe(2);
    expect(proc.stderr).toContain('unknown option: --bogus');
  });
});
