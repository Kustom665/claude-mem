/**
 * Serialises calls to a shared upstream with a minimum gap between them.
 *
 * Nominatim's usage policy caps clients at one request per second and will
 * block an app that ignores it. Everything in this codebase that touches a free
 * public endpoint goes through one of these queues.
 */
export function createThrottle(minIntervalMs: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = 0;

  return function throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const wait = Math.max(0, lastStart + minIntervalMs - Date.now());
      if (wait > 0) {
        // Deliberately not unref'd: this timer is the only thing keeping the
        // event loop alive between queued calls, and unref'ing it lets a
        // short-lived process (a CLI script, a cron job) exit mid-queue with
        // the awaiting promise never settling.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, wait);
        });
      }
      lastStart = Date.now();
      return await fn();
    };

    // Keep the chain alive even when a caller rejects, or one failure would
    // wedge every subsequent request behind a settled-rejected promise.
    const result = chain.then(run, run);
    chain = result.catch(() => undefined);
    return result;
  };
}
