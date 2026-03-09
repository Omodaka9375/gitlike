// ---------------------------------------------------------------------------
// GitLike — SocialLock Durable Object
// Serializes follow/star mutations to prevent read-modify-write races on KV.
// ---------------------------------------------------------------------------

import type { Env } from './env.js';

/** Mutation payloads accepted by SocialLock. */
export type SocialMutation =
  | { action: 'follow'; caller: string; target: string }
  | { action: 'unfollow'; caller: string; target: string }
  | { action: 'star'; caller: string; repoId: string }
  | { action: 'unstar'; caller: string; repoId: string };

/** Read a JSON string-array from KV, defaulting to []. */
async function readList(kv: KVNamespace, key: string): Promise<string[]> {
  const raw = await kv.get(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export class SocialLock {
  private env: Env;

  constructor(_state: DurableObjectState, env: Env) {
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const mutation = (await request.json()) as SocialMutation;
    const kv = this.env.SESSIONS;

    switch (mutation.action) {
      case 'follow': {
        const { caller, target } = mutation;
        const following = await readList(kv, `following:${caller}`);
        if (!following.includes(target)) {
          following.push(target);
          await kv.put(`following:${caller}`, JSON.stringify(following));
        }
        const followers = await readList(kv, `followers:${target}`);
        if (!followers.includes(caller)) {
          followers.push(caller);
          await kv.put(`followers:${target}`, JSON.stringify(followers));
        }
        return Response.json({
          followingCount: following.length,
          followersCount: followers.length,
        });
      }
      case 'unfollow': {
        const { caller, target } = mutation;
        let following = await readList(kv, `following:${caller}`);
        following = following.filter((a) => a !== target);
        await kv.put(`following:${caller}`, JSON.stringify(following));
        let followers = await readList(kv, `followers:${target}`);
        followers = followers.filter((a) => a !== caller);
        await kv.put(`followers:${target}`, JSON.stringify(followers));
        return Response.json({
          followingCount: following.length,
          followersCount: followers.length,
        });
      }
      case 'star': {
        const { caller, repoId } = mutation;
        const stars = await readList(kv, `stars:${repoId}`);
        if (!stars.includes(caller)) {
          stars.push(caller);
          await kv.put(`stars:${repoId}`, JSON.stringify(stars));
        }
        const starred = await readList(kv, `starred:${caller}`);
        if (!starred.includes(repoId)) {
          starred.push(repoId);
          await kv.put(`starred:${caller}`, JSON.stringify(starred));
        }
        return Response.json({ count: stars.length, starred: true });
      }
      case 'unstar': {
        const { caller, repoId } = mutation;
        let stars = await readList(kv, `stars:${repoId}`);
        stars = stars.filter((a) => a !== caller);
        await kv.put(`stars:${repoId}`, JSON.stringify(stars));
        let starred = await readList(kv, `starred:${caller}`);
        starred = starred.filter((id) => id !== repoId);
        await kv.put(`starred:${caller}`, JSON.stringify(starred));
        return Response.json({ count: stars.length, starred: false });
      }
      default:
        return Response.json({ error: 'Unknown action.' }, { status: 400 });
    }
  }
}
