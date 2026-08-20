/**
 * Networking.
 *
 * Sockets are a kernel resource behind a device abstraction, the same way the
 * console is: the kernel never talks to a real WebSocket directly, so the OS
 * stays fully testable offline and a fake transport is a drop-in.
 *
 * Incoming frames are *buffered*. A socket that only captured a message when a
 * process happened to be asking for one would silently drop everything that
 * arrived in between — the exact bug that broke piped input on the console.
 */

export interface Socket {
  send(data: string): void;
  /** Next frame, or null once the peer has closed and the buffer is drained. */
  recv(): Promise<string | null>;
  close(): void;
  readonly closed: boolean;
}

export interface NetworkDevice {
  readonly name: string;
  connect(url: string): Promise<Socket>;
}

/** Shared queue/waiter plumbing for both real and fake sockets. */
export abstract class BufferedSocket implements Socket {
  private readonly queue: string[] = [];
  private readonly waiters: Array<(msg: string | null) => void> = [];
  private ended = false;

  abstract send(data: string): void;
  abstract close(): void;

  get closed(): boolean {
    return this.ended;
  }

  /** Called by the transport when a frame arrives. */
  protected deliver(data: string): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(data);
    else this.queue.push(data);
  }

  /** Frames received but not yet consumed. */
  protected get buffered(): number {
    return this.queue.length;
  }

  /** Called by the transport on close/error. Drains anything still waiting. */
  protected end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  recv(): Promise<string | null> {
    // Buffered frames are delivered before the close is reported, so a burst
    // arriving just before disconnect is not lost.
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.ended) return Promise.resolve(null);
    return new Promise<string | null>((resolve) => this.waiters.push(resolve));
  }
}

/** Socket backed by a real WebSocket. */
class WebSocketSocket extends BufferedSocket {
  constructor(private readonly ws: WebSocket) {
    super();
    ws.addEventListener('message', (event: MessageEvent) => {
      this.deliver(typeof event.data === 'string' ? event.data : String(event.data));
    });
    ws.addEventListener('close', () => this.end());
    ws.addEventListener('error', () => this.end());
  }

  send(data: string): void {
    if (this.closed) throw new Error('socket is closed');
    this.ws.send(data);
  }

  close(): void {
    try {
      this.ws.close();
    } finally {
      this.end();
    }
  }
}

/** Real network. Only permits wss:// and ws:// URLs. */
export class WebSocketNetwork implements NetworkDevice {
  readonly name = 'websocket';

  constructor(private readonly timeoutMs = 15_000) {}

  connect(url: string): Promise<Socket> {
    if (!/^wss?:\/\//i.test(url)) {
      return Promise.reject(new Error(`unsupported protocol: ${url.split(':')[0]}`));
    }

    return new Promise<Socket>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          /* already closing */
        }
        reject(new Error(`connection to ${redactUrl(url)} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      ws.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(new WebSocketSocket(ws));
      });

      ws.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`connection to ${redactUrl(url)} failed`));
      });
    });
  }
}

/**
 * Scripted network for tests.
 *
 * Each connection replays `script` and records everything sent, so a daemon can
 * be driven through connect/subscribe/receive/close without a real endpoint.
 */
export class FakeNetwork implements NetworkDevice {
  readonly name = 'fake';
  /** Every URL that was connected to, in order. */
  readonly connections: string[] = [];
  readonly sockets: FakeSocket[] = [];

  constructor(
    private readonly script: string[][] = [],
    private readonly failUrls: RegExp | null = null,
  ) {}

  connect(url: string): Promise<Socket> {
    this.connections.push(url);
    if (this.failUrls?.test(url)) {
      return Promise.reject(new Error(`connection to ${redactUrl(url)} failed`));
    }
    // Each successive connection replays the next scripted conversation; the
    // last one repeats so reconnect loops stay driveable.
    const index = Math.min(this.sockets.length, Math.max(0, this.script.length - 1));
    const socket = new FakeSocket(this.script[index] ?? []);
    this.sockets.push(socket);
    return Promise.resolve(socket);
  }
}

export class FakeSocket extends BufferedSocket {
  /** Frames the process sent, for assertions. */
  readonly sent: string[] = [];
  private scriptDrained = false;

  constructor(frames: string[]) {
    super();
    // Deliver on a later tick so a process genuinely blocks in recv first.
    queueMicrotask(() => {
      for (const frame of frames) this.deliver(frame);
      this.scriptDrained = true;
    });
  }

  send(data: string): void {
    if (this.closed) throw new Error('socket is closed');
    this.sent.push(data);
  }

  override recv(): Promise<string | null> {
    // Close only once the script is exhausted *and* fully consumed. Ending at
    // construction time would slam the socket shut before the process under
    // test ever got to send its subscribe frames, which no real peer does.
    if (this.scriptDrained && this.buffered === 0) this.end();
    return super.recv();
  }

  close(): void {
    this.end();
  }

  /** Push an extra frame from a test after construction. */
  emit(data: string): void {
    this.deliver(data);
  }
}

/**
 * Strip query strings from a URL before it reaches a log or an error message.
 * BuiltWith and friends put the API key in the query, so an unredacted URL in
 * a stack trace is a leaked credential.
 */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : `${url.slice(0, queryStart)}?<redacted>`;
}
