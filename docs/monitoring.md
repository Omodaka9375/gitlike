# Monitoring & Alerting

## Cloudflare Dashboard Alerts

**Note:** Workers notification options (Weekly Summary, Usage Report) only appear in the CF dashboard for accounts with a **paid Workers subscription**. On the free plan, these options are not available.

If you upgrade to a paid plan later: **Account Home → Notifications → Add → Workers product**.

For now, skip CF dashboard alerts and use external monitoring instead.

### What CF does NOT offer (any plan)
Cloudflare does not offer per-worker error rate or latency threshold alerts. For that level of monitoring, use one of:
- **External uptime checks** (UptimeRobot/Betterstack — see below)
- **Log forwarding** to Axiom/Datadog via `tail_consumers` in `wrangler.toml`, then set alerts there
- **Self-monitoring worker** that queries the Workers Analytics GraphQL API on a cron schedule

## Uptime Monitoring

Use an external service to ping the health endpoint. Free options:

### UptimeRobot (recommended)
1. Create account at [uptimerobot.com](https://uptimerobot.com)
2. Add monitor:
   - **Type:** HTTP(s)
   - **URL:** `https://gitlike.dev/api/health/deep`
   - **Interval:** 5 minutes
   - **Alert on:** HTTP status ≠ 200, or response body does not contain `"ok":true`
3. Add a second monitor for Pages:
   - **URL:** `https://app.gitlike.dev/`
   - **Alert on:** HTTP status ≠ 200

### Alert Channels
- Email alerts for all monitors
- Optional: Discord/Slack webhook for faster response

## Structured Logging

All Worker requests are logged as structured JSON via `console.log`. Cloudflare captures these in **Workers Logs** (dashboard → Workers → Logs).

Log fields:
- `level`: `info` | `warn` | `error`
- `requestId`: 8-char UUID prefix for request correlation
- `method`, `path`, `status`, `durationMs`: Request metadata
- `address`: Authenticated wallet address (if any)
- `error`: Error message (on `warn`/`error` level)

### Unhandled Errors
The global `app.onError()` handler catches all uncaught exceptions and logs:
- `type: 'unhandled'`
- `message`, `stack` (truncated to 500 chars)
- `method`, `path`

### Client-Side Errors
The SPA reports errors to `POST /api/errors`, which logs:
- `type: 'client-error'`
- `message` (truncated to 500 chars), `source`, `url`

## Live Debugging

For real-time log streaming during development or incident response:

```bash
wrangler tail gitlike
wrangler tail gitlike-pages
```

## Health Endpoints

- `GET /api/health` — Lightweight liveness check (always 200 if worker is running)
- `GET /api/health/deep` — Checks KV and Pinata gateway connectivity. Returns 503 if either is down.

## Setup Checklist

1. Sign up for UptimeRobot and add both monitors
2. Verify `wrangler tail` works for live debugging
3. Deploy with `pnpm deploy` and `pnpm deploy:pages`
