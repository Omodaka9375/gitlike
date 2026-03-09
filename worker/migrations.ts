// ---------------------------------------------------------------------------
// GitLike — KV Schema Migrations
// Versioned migration runner. Stores current version in kv:schema_version.
// Called from the scheduled handler (daily cron).
// ---------------------------------------------------------------------------

import type { Env } from './env.js';
import { bootstrapIndex } from './repo-index.js';

/** KV key for the current schema version. */
const SCHEMA_VERSION_KEY = 'kv:schema_version';

/** A single migration step. */
type Migration = {
  version: number;
  name: string;
  run: (env: Env) => Promise<void>;
};

/** All migrations in order. Add new ones at the end. */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'bootstrap-repo-index',
    async run(env) {
      const count = await bootstrapIndex(env);
      console.log(
        JSON.stringify({
          level: 'info',
          type: 'migration',
          name: 'bootstrap-repo-index',
          repos: count,
        }),
      );
    },
  },
];

/** Run any pending migrations. Returns the number of migrations applied. */
export async function runMigrations(env: Env): Promise<number> {
  const raw = await env.SESSIONS.get(SCHEMA_VERSION_KEY);
  const current = raw ? parseInt(raw, 10) : 0;

  const pending = MIGRATIONS.filter((m) => m.version > current);
  if (pending.length === 0) return 0;

  for (const m of pending) {
    console.log(
      JSON.stringify({
        level: 'info',
        type: 'migration',
        action: 'start',
        version: m.version,
        name: m.name,
      }),
    );
    await m.run(env);
    await env.SESSIONS.put(SCHEMA_VERSION_KEY, String(m.version));
    console.log(
      JSON.stringify({
        level: 'info',
        type: 'migration',
        action: 'done',
        version: m.version,
        name: m.name,
      }),
    );
  }

  return pending.length;
}
