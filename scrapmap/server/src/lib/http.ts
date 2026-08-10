import { env } from '../env.ts';

export class UpstreamError extends Error {
  readonly status: number | null;
  readonly url: string;

  constructor(message: string, url: string, status: number | null) {
    super(message);
    this.name = 'UpstreamError';
    this.url = url;
    this.status = status;
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  method?: 'GET' | 'POST';
  body?: string | URLSearchParams;
  /** Identifies the caller in logs. */
  label?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// Not unref'd, for the same reason as the throttle: a retry backoff has to keep
// the process alive, or a short-lived script exits with the retry never firing.
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * fetch with a hard timeout, bounded retries on transient failures, and the
 * descriptive User-Agent that OSM services require. Every upstream in this app
 * is a free public endpoint, so being a well-behaved client is not optional.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  if (env.offlineMode) {
    throw new UpstreamError('OFFLINE_MODE is enabled; outbound requests are disabled.', url, null);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        body: options.body,
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': env.osmUserAgent,
          'Accept-Language': 'en',
          ...options.headers,
        },
      });

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          lastError = new UpstreamError(
            `${options.label ?? 'upstream'} returned ${response.status}`,
            url,
            response.status,
          );
          await sleep(250 * 2 ** attempt);
          continue;
        }
        throw new UpstreamError(
          `${options.label ?? 'upstream'} returned ${response.status}`,
          url,
          response.status,
        );
      }

      return response;
    } catch (error) {
      lastError = error;
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const retryable = isAbort || !(error instanceof UpstreamError);
      if (attempt < retries && retryable) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError(
        isAbort
          ? `${options.label ?? 'upstream'} timed out after ${timeoutMs}ms`
          : `${options.label ?? 'upstream'} request failed: ${(error as Error).message}`,
        url,
        null,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new UpstreamError('Request failed', url, null);
}

export async function fetchJson<T>(url: string, options?: FetchOptions): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: { Accept: 'application/json', ...options?.headers },
  });
  return (await response.json()) as T;
}

export async function fetchText(url: string, options?: FetchOptions): Promise<string> {
  const response = await fetchWithRetry(url, options);
  return await response.text();
}
