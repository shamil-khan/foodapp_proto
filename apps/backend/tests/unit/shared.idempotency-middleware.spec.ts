import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { idempotencyMiddleware } from '@/core/services/idempotency-middleware';
import { InMemoryIdempotencyStore } from '../fakes/in-memory-idempotency-store';

describe('shared.idempotency-middleware — SHA-256 Hash Replay & Lock Guard', () => {
  it('replays cached response on identical payload and returns 422 on payload mismatch', async () => {
    const store = new InMemoryIdempotencyStore();
    let executions = 0;

    const app = new Hono();
    app.use(
      '/pay',
      idempotencyMiddleware({
        store,
        required: true,
      }),
    );
    app.post('/pay', async (c) => {
      executions += 1;
      return c.json(
        {
          txId: `tx-${executions}`,
        },
        201,
      );
    });

    const missingKey = await app.request('/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: '12.00',
      }),
    });
    expect(missingKey.status).toBe(400);

    const first = await app.request('/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'key-abc-123',
      },
      body: JSON.stringify({
        amount: '12.00',
      }),
    });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({
      txId: 'tx-1',
    });

    const replay = await app.request('/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'key-abc-123',
      },
      body: JSON.stringify({
        amount: '12.00',
      }),
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('X-Idempotent-Replay')).toBe('true');
    expect(executions).toBe(1);

    const mismatch = await app.request('/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'key-abc-123',
      },
      body: JSON.stringify({
        amount: '55.00',
      }),
    });
    expect(mismatch.status).toBe(422);
  });
});
