// ---------------------------------------------------------------------------
// GitLike — Structured Logging
// JSON logs to console.log (captured by Cloudflare Workers Logs).
// ---------------------------------------------------------------------------

import type { Context, Next, MiddlewareHandler } from 'hono';
import type { HonoEnv } from './index.js';

/** Structured log entry. */
type LogEntry = {
  level: 'info' | 'warn' | 'error';
  requestId: string;
  method: string;
  path: string;
  status?: number;
  durationMs?: number;
  error?: string;
  address?: string;
};

/** Log a structured JSON entry. */
function log(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

/** Request logging middleware — logs method, path, status, and duration. */
export const requestLogger: MiddlewareHandler<HonoEnv> = async (
  c: Context<HonoEnv>,
  next: Next,
) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const start = Date.now();

  try {
    await next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log({
      level: 'error',
      requestId,
      method: c.req.method,
      path: c.req.path,
      error: msg,
      address: c.get('address'),
    });
    throw err;
  }

  log({
    level: c.res.status >= 400 ? 'warn' : 'info',
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
    address: c.get('address'),
  });
};
