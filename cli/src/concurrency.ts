// ---------------------------------------------------------------------------
// GitLike CLI — Concurrency Limiter
// Promise-based concurrency limiter for parallel async operations.
// ---------------------------------------------------------------------------

/** Max concurrent operations for downloads and uploads. */
export const CONCURRENCY = 6;

/** Creates a promise-based concurrency limiter. */
export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = async () => {
        active++;
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          active--;
          if (queue.length > 0) queue.shift()!();
        }
      };

      if (active < max) {
        run();
      } else {
        queue.push(run);
      }
    });
}
