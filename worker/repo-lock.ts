// ---------------------------------------------------------------------------
// GitLike — RepoLock Durable Object
// Serializes write operations per repo. Single-threaded execution guarantees
// no two mutations run concurrently for the same repository.
// ---------------------------------------------------------------------------

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.js';
import { dispatchMutation, MutationError } from './mutations.js';
import type { MutationInput } from './mutations.js';

/**
 * Each repo gets one RepoLock instance (keyed by groupId).
 * The Worker forwards mutation requests here; the DO processes them
 * one at a time, providing true serialization without the race
 * conditions of KV-based locking.
 */
export class RepoLock extends DurableObject<Env> {
  /**
   * Handle an incoming mutation request.
   * Because DO execution is single-threaded, concurrent requests
   * queue automatically — no explicit lock needed.
   */
  async fetch(request: Request): Promise<Response> {
    try {
      const input = await request.json<MutationInput>();
      const result = await dispatchMutation(this.env, input);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      if (err instanceof MutationError) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: err.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const msg = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}
