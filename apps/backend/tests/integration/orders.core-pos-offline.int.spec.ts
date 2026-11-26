import { randomUUID } from 'node:crypto';
import { pgPool, redisClient } from '@foodapp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@/app';

const app = createApp();

async function loginPos(credentials: {
  brandHandle: string;
  email: string;
  password: string;
  branchId?: string;
}): Promise<string> {
  const res = await app.request('/api/pos/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });
  const body = (await res.json()) as {
    token?: string;
  };
  return body.token ?? '';
}

describe('orders.core-pos-offline — Core Ordering, Offline POS Sync, KDS & Lifecycle Concurrency', () => {
  const cliftonBranchId = 'b0000000-0000-4000-8000-000000000006';
  const menuItemId = 'e0000000-0000-4000-8000-000000000006';
  const customerId = '11111111-1111-4111-8111-111111111111';
  let ownerToken = '';

  beforeAll(async () => {
    if (!redisClient.isOpen) await redisClient.connect();
    ownerToken = await loginPos({
      brandHandle: 'pizza-hut',
      email: 'tom@pizza-hut.com',
      password: 'Password123!',
      branchId: cliftonBranchId,
    });
  });

  afterAll(async () => {
    if (redisClient.isOpen) await redisClient.quit();
  });

  it('syncs offline POS batch with tips & customer loyalty, and rejects missing menu items (404)', async () => {
    const clientOrderId = `POS-TIP-${randomUUID().slice(0, 8)}`;
    const syncOk = await app.request('/api/pos/orders/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        orders: [
          {
            clientOrderId,
            posTerminalId: 'POS-FLOOR-02',
            posReceiptNumber: 'RCP-7701',
            occurredAt: new Date().toISOString(),
            orderSource: 'POS',
            paymentMethod: 'CARD_TERMINAL',
            customerId,
            tipAmountGbp: 2.5,
            items: [
              {
                menuItemId,
                quantity: 2,
              },
            ],
          },
        ],
      }),
    });
    expect(syncOk.status).toBe(200);
    const syncBody = (await syncOk.json()) as {
      syncedCount: number;
      results: Array<{
        orderId: string;
        status: string;
      }>;
    };
    expect(syncBody.syncedCount).toBe(1);

    const detail = await app.request(`/api/orders/${syncBody.results[0]?.orderId}`, {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(detail.status).toBe(200);

    const missingItemSync = await app.request('/api/pos/orders/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        orders: [
          {
            clientOrderId: `POS-MISS-${randomUUID().slice(0, 8)}`,
            posTerminalId: 'POS-FLOOR-02',
            posReceiptNumber: 'RCP-7702',
            occurredAt: new Date().toISOString(),
            orderSource: 'POS',
            paymentMethod: 'CASH',
            items: [
              {
                menuItemId: '00000000-0000-4000-8000-999999999999',
                quantity: 1,
              },
            ],
          },
        ],
      }),
    });
    expect(missingItemSync.status).toBe(404);
  });
  it('enforces order lifecycle transitions, optimistic rowVersion lock (409), and EXTERNAL_3PL courier dispatch', async () => {
    await pgPool.query(
      `UPDATE "RestaurantBranch" SET "deliveryMode" = 'EXTERNAL_3PL', "deliveryProviderCode" = 'stuart' WHERE "id" = $1`,
      [
        cliftonBranchId,
      ],
    );

    const placed = await app.request('/api/pos/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        orderSource: 'ONLINE_DELIVERY',
        customerId,
        items: [
          {
            menuItemId,
            quantity: 1,
          },
        ],
      }),
    });
    expect(placed.status).toBe(201);
    const { orderId } = (await placed.json()) as {
      orderId: string;
    };

    const staleLock = await app.request(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        toStatus: 'ACCEPTED',
        expectedRowVersion: 99,
      }),
    });
    expect(staleLock.status).toBe(409);

    for (const toStatus of [
      'ACCEPTED',
      'PREPARING',
      'OUT_FOR_DELIVERY',
    ] as const) {
      const step = await app.request(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          toStatus,
        }),
      });
      expect(step.status).toBe(200);
    }

    const cancelAfterDispatch = await app.request(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        toStatus: 'CANCELLED',
        reason: 'Late customer cancel attempt',
      }),
    });
    expect(cancelAfterDispatch.status).toBe(409);

    const detail = await app.request(`/api/orders/${orderId}`, {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      deliveryProviderCode: string | null;
      externalDeliveryId: string | null;
    };
    expect(detailBody.deliveryProviderCode).toBe('stuart');
    expect(detailBody.externalDeliveryId).toBeTruthy();
  });

  it('evaluates promo code edge cases (unknown promo 404, takeaway zero delivery fee) in PreviewOrder', async () => {
    const takeawayPreview = await app.request('/api/orders/preview', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        branchId: cliftonBranchId,
        orderSource: 'TAKEAWAY',
        promoCode: 'UKLAUNCH20',
        items: [
          {
            menuItemId,
            quantity: 2,
          },
        ],
      }),
    });
    expect(takeawayPreview.status).toBe(200);
    const body = (await takeawayPreview.json()) as {
      deliveryFeeGbp: string;
      promoDiscountGbp: string;
    };
    expect(body.deliveryFeeGbp).toBe('0.00');
    expect(Number(body.promoDiscountGbp)).toBeGreaterThan(0);

    const badPromo = await app.request('/api/orders/preview', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        branchId: cliftonBranchId,
        orderSource: 'DINE_IN',
        promoCode: 'DOES_NOT_EXIST_99',
        items: [
          {
            menuItemId,
            quantity: 1,
          },
        ],
      }),
    });
    expect(badPromo.status).toBe(404);
  });
});
