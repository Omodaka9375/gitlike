// ---------------------------------------------------------------------------
// GitLike — SIWE Authentication
// Nonce generation, signature verification, session management.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { verifyMessage, hashMessage, recoverPublicKey } from 'viem';
import type { HonoEnv } from './index.js';

import { parseSiweMessage } from './siwe-parser.js';

const auth = new Hono<HonoEnv>();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Nonce TTL in seconds. */
const NONCE_TTL = 300;

/** Session TTL in seconds (24 hours). */
const SESSION_TTL = 86_400;

// ---------------------------------------------------------------------------
// POST /api/auth/nonce — generate a random nonce
// ---------------------------------------------------------------------------

auth.post('/nonce', async (c) => {
  const nonce = crypto.randomUUID();
  await c.env.SESSIONS.put(`nonce:${nonce}`, '1', { expirationTtl: NONCE_TTL });
  return c.json({ nonce });
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify — verify SIWE signature, create session
// ---------------------------------------------------------------------------

auth.post('/verify', async (c) => {
  const body = await c.req.json<{ message: string; signature: string }>();

  if (!body.message || !body.signature) {
    return c.json({ error: 'Missing message or signature.' }, 400);
  }

  // Parse SIWE fields from the message
  const parsed = parseSiweMessage(body.message);
  if (!parsed) {
    return c.json({ error: 'Invalid SIWE message format.' }, 400);
  }

  // Validate domain and URI against expected origin
  const allowed = c.env.ALLOWED_ORIGIN;
  if (allowed) {
    const allowedUrl = new URL(allowed);
    if (parsed.domain !== allowedUrl.host) {
      return c.json({ error: 'SIWE domain mismatch.' }, 400);
    }
    if (parsed.uri && parsed.uri !== allowed) {
      return c.json({ error: 'SIWE URI mismatch.' }, 400);
    }
  }

  // Verify nonce exists and hasn't expired
  const nonceKey = `nonce:${parsed.nonce}`;
  const nonceExists = await c.env.SESSIONS.get(nonceKey);
  if (!nonceExists) {
    return c.json({ error: 'Invalid or expired nonce.' }, 400);
  }

  // Delete nonce (single-use)
  await c.env.SESSIONS.delete(nonceKey);

  // Check expiration if present
  if (parsed.expirationTime) {
    const expiry = new Date(parsed.expirationTime);
    if (expiry < new Date()) {
      return c.json({ error: 'SIWE message expired.' }, 400);
    }
  }

  // Verify signature using viem
  let valid: boolean;
  try {
    valid = await verifyMessage({
      address: parsed.address as `0x${string}`,
      message: body.message,
      signature: body.signature as `0x${string}`,
    });
  } catch {
    return c.json({ error: 'Signature verification failed.' }, 400);
  }

  if (!valid) {
    return c.json({ error: 'Invalid signature.' }, 401);
  }

  // Recover and store the signer's public key (best-effort, for encryption)
  try {
    const msgHash = hashMessage(body.message);
    const pubKey = await recoverPublicKey({
      hash: msgHash,
      signature: body.signature as `0x${string}`,
    });
    await c.env.SESSIONS.put(`pubkey:${parsed.address.toLowerCase()}`, pubKey);
  } catch {
    // Non-critical — pubkey recovery failure doesn't block auth
  }

  // Create session token
  const token = crypto.randomUUID();
  await c.env.SESSIONS.put(`session:${token}`, parsed.address, {
    expirationTtl: SESSION_TTL,
  });

  return c.json({ token, address: parsed.address });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout — destroy session
// ---------------------------------------------------------------------------

auth.post('/logout', async (c) => {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7);
    await c.env.SESSIONS.delete(`session:${token}`);
  }
  return c.json({ ok: true });
});

export { auth as authRoutes };
