import { describe, it, expect } from 'vitest';
import { MutationError, dispatchMutation } from '../../worker/mutations.js';
import type { MutationInput } from '../../worker/mutations.js';
import type { Env } from '../../worker/env.js';

// ---------------------------------------------------------------------------
// MutationError
// ---------------------------------------------------------------------------

describe('MutationError', () => {
  it('sets message and status', () => {
    const err = new MutationError('Not found', 404);
    expect(err.message).toBe('Not found');
    expect(err.status).toBe(404);
  });

  it('is an instance of Error', () => {
    const err = new MutationError('fail', 500);
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "MutationError"', () => {
    const err = new MutationError('x', 400);
    expect(err.name).toBe('MutationError');
  });

  it('preserves various status codes', () => {
    expect(new MutationError('a', 400).status).toBe(400);
    expect(new MutationError('b', 403).status).toBe(403);
    expect(new MutationError('c', 409).status).toBe(409);
    expect(new MutationError('d', 500).status).toBe(500);
  });

  it('can be caught with try/catch', () => {
    try {
      throw new MutationError('test', 422);
    } catch (err) {
      expect(err).toBeInstanceOf(MutationError);
      expect((err as MutationError).status).toBe(422);
    }
  });
});

// ---------------------------------------------------------------------------
// dispatchMutation — unknown action
// ---------------------------------------------------------------------------

describe('dispatchMutation', () => {
  it('throws MutationError 400 for unknown action', async () => {
    const fakeEnv = {} as Env;
    const badInput = { action: 'nonexistent' } as unknown as MutationInput;

    await expect(dispatchMutation(fakeEnv, badInput)).rejects.toThrow(MutationError);

    try {
      await dispatchMutation(fakeEnv, badInput);
    } catch (err) {
      expect(err).toBeInstanceOf(MutationError);
      expect((err as MutationError).status).toBe(400);
      expect((err as MutationError).message).toContain('nonexistent');
    }
  });
});
