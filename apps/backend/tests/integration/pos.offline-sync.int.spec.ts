import { randomUUID } from 'node:crypto';
import { pgPool, redisClient } from '@foodapp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@/app';

const app = createApp();

async function getTomCliftonToken(): Promise<string> {
  const res = await app.request('/api/pos/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      brandHandle: 'pizza-hut',
      email: 'tom@pizza-hut.com',
      password: 'Password123!',
      branchId: 'b0000000-0000-4000-8000-000000000006',
    }),
  });
  const body = (await res.json()) as {
    token?: string;
  };
  return body.token ?? '';
}

describe('pos.offline-sync — Offline POS Terminal Batch Sync & Deduplication', () => {
  const menuItemId = 'e0000000-0000-4000-8000-000000000006';

  beforeAll(async () => {
    if (!redisClient.isOpen) await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient.isOpen) await redisClient.quit();
  });

  it('inserts offline POS receipts once and deduplicates retries by clientOrderId', async () => {
    const token = await getTomCliftonToken();
    const clientOrderId = `POS01-${randomUUID().slice(0, 8)}`;
    const payload = {
      orders: [
        {
          clientOrderId,
          posTerminalId: 'POS01',
          posReceiptNumber: 'R-9001',
          occurredAt: new Date().toISOString(),
          orderSource: 'POS',
          paymentMethod: 'CARD_TERMINAL',
          items: [
            {
              menuItemId,
              quantity: 1,
            },
          ],
        },
      ],
    };

    const firstRes = await app.request('/api/pos/orders/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as {
      syncedCount: number;
      results: Array<{
        orderId: string;
        status: string;
      }>;
    };
    expect(firstBody.syncedCount).toBe(1);

    const secondRes = await app.request('/api/pos/orders/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as {
      syncedCount: number;
      results: Array<{
        orderId: string;
        status: string;
      }>;
    };
    expect(secondBody.syncedCount).toBe(0);
    expect(secondBody.results[0]?.orderId).toBe(firstBody.results[0]?.orderId);
    expect(secondBody.results[0]?.status).toBe('DUPLICATE_SKIPPED');

    const dbRows = await pgPool.query<{
      count: string;
    }>(`SELECT count(*)::text FROM "Order" WHERE "idempotencyKey" = $1`, [
      clientOrderId,
    ]);
    expect(Number(dbRows.rows[0]?.count)).toBe(1);
  });

  it('rejects offline sync batch containing menu items from another brand', async () => {
    const token = await getTomCliftonToken();
    const foreignMenuItemId = 'e0000000-0000-4000-8000-000000000004';

    const res = await app.request('/api/pos/orders/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        orders: [
          {
            clientOrderId: `POS01-FOREIGN-${randomUUID().slice(0, 8)}`,
            posTerminalId: 'POS01',
            posReceiptNumber: 'R-9002',
            occurredAt: new Date().toISOString(),
            orderSource: 'POS',
            paymentMethod: 'CASH',
            items: [
              {
                menuItemId: foreignMenuItemId,
                quantity: 1,
              },
            ],
          },
        ],
      }),
    });
    expect(res.status).toBe(403);
  });
});
