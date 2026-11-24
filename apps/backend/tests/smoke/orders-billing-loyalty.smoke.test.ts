import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiTestClient, loginPosStaff } from '../helpers/api-client.js';

describe('Storefront Orders, Double-Entry Billing, Multi-Scope Loyalty & Webhooks', () => {
  const client = new ApiTestClient();
  const cliftonBranchId = 'b0000000-0000-4000-8000-000000000006';
  const edgbastonBranchId = 'b0000000-0000-4000-8000-000000000007';
  const pizzaHutMenuItemId = 'e0000000-0000-4000-8000-000000000006';
  const pizzaInMenuItemId = 'e0000000-0000-4000-8000-000000000004';
  const seededCustomerId = '11111111-1111-4111-8111-111111111111';

  let cliftonOwnerToken = '';
  let edgbastonOwnerToken = '';

  beforeAll(async () => {
    cliftonOwnerToken = await loginPosStaff(client, {
      brandHandle: 'pizza-hut',
      email: 'tom@pizza-hut.com',
      password: 'Password123!',
      branchId: cliftonBranchId,
    });

    edgbastonOwnerToken = await loginPosStaff(client, {
      brandHandle: 'pizza-hut',
      email: 'tom@pizza-hut.com',
      password: 'Password123!',
      branchId: edgbastonBranchId,
    });
  });

  it('public order preview calculates totals with promo code and rejects unknown branch (404)', async () => {
    const preview = await client.post<{
      subtotalGbp: string;
      vatTotalGbp: string;
      totalAmountGbp: string;
    }>('/api/orders/preview', {
      branchId: cliftonBranchId,
      orderSource: 'ONLINE_DELIVERY',
      promoCode: 'UKLAUNCH20',
      items: [
        {
          menuItemId: pizzaHutMenuItemId,
          quantity: 2,
        },
      ],
    });
    expect(preview.status).toBe(200);
    expect(Number(preview.body.totalAmountGbp)).toBeGreaterThan(0);

    const missingBranch = await client.post('/api/orders/preview', {
      branchId: '00000000-0000-4000-8000-999999999999',
      orderSource: 'ONLINE_DELIVERY',
      items: [
        {
          menuItemId: pizzaHutMenuItemId,
          quantity: 1,
        },
      ],
    });
    expect(missingBranch.status).toBe(404);
  });

  it('enforces 401 on unauthenticated cart/checkout and 403 on cross-tenant POS order', async () => {
    const unauthCart = await client.get(`/api/orders/cart/${cliftonBranchId}`);
    expect(unauthCart.status).toBe(401);

    const unauthCheckout = await client.post('/api/orders/checkout', {
      branchId: cliftonBranchId,
      orderSource: 'ONLINE_DELIVERY',
      paymentMode: 'ONLINE_GATEWAY',
      items: [
        {
          menuItemId: pizzaHutMenuItemId,
          quantity: 1,
        },
      ],
    });
    expect(unauthCheckout.status).toBe(401);

    const foreignItem = await client.post<{
      code: string;
    }>(
      '/api/pos/orders',
      {
        orderSource: 'DINE_IN',
        items: [
          {
            menuItemId: pizzaInMenuItemId,
            quantity: 1,
          },
        ],
      },
      {
        token: cliftonOwnerToken,
      },
    );
    expect(foreignItem.status).toBe(403);
    expect(foreignItem.body.code).toBe('TENANT_FORBIDDEN');

    // FILE: apps/backend/tests/smoke/orders-billing-loyalty.smoke.test.ts (inside 401/403 test)
    const unauthPosList = await client.get<{
      code: string;
    }>('/api/pos/orders');
    expect(unauthPosList.status).toBe(401);
    expect(unauthPosList.body.code).toBe('UNAUTHORIZED');

    const unauthPosListWithBranch = await client.get<{
      code: string;
    }>(`/api/pos/orders?restaurantId=${cliftonBranchId}`);
    expect(unauthPosListWithBranch.status).toBe(401);
    expect(unauthPosListWithBranch.body.code).toBe('UNAUTHORIZED');

    const unauthPosPlace = await client.post<{
      code: string;
    }>('/api/pos/orders', {
      orderSource: 'DINE_IN',
      items: [
        {
          menuItemId: pizzaHutMenuItemId,
          quantity: 1,
        },
      ],
    });
    expect(unauthPosPlace.status).toBe(401);
    expect(unauthPosPlace.body.code).toBe('UNAUTHORIZED');
  });

  it('places POS order (201), settles bill (200), blocks duplicate settle (400), and inspects billing', async () => {
    const created = await client.post<{
      orderId: string;
      kdsTickets: {
        orderId: string;
      };
    }>(
      '/api/pos/orders',
      {
        orderSource: 'DINE_IN',
        customerId: seededCustomerId,
        items: [
          {
            menuItemId: pizzaHutMenuItemId,
            quantity: 2,
          },
        ],
      },
      {
        token: cliftonOwnerToken,
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.orderId).toBeTruthy();
    const posOrderId = created.body.orderId;

    const crossSettle = await client.post<{
      code: string;
    }>(
      `/api/pos/orders/${posOrderId}/settle`,
      {
        paymentMethod: 'CASH',
        tipAmount: 0,
      },
      {
        token: edgbastonOwnerToken,
      },
    );
    expect(crossSettle.status).toBe(403);
    expect(crossSettle.body.code).toBe('BRANCH_FORBIDDEN');

    const settled = await client.post(
      `/api/pos/orders/${posOrderId}/settle`,
      {
        paymentMethod: 'CASH',
        tipAmount: 1.5,
      },
      {
        token: cliftonOwnerToken,
      },
    );
    expect(settled.status).toBe(200);

    const dupSettle = await client.post<{
      code: string;
    }>(
      `/api/pos/orders/${posOrderId}/settle`,
      {
        paymentMethod: 'CASH',
        tipAmount: 0,
      },
      {
        token: cliftonOwnerToken,
      },
    );
    expect(dupSettle.status).toBe(400);
    expect(dupSettle.body.code).toBe('ALREADY_SETTLED');

    const billing = await client.get<{
      recentJournalLines: Array<{
        orderId: string;
      }>;
    }>('/api/billing/restaurant', {
      token: cliftonOwnerToken,
    });
    expect(billing.status).toBe(200);
    expect(billing.body.recentJournalLines.some((e) => e.orderId === posOrderId)).toBe(true);
  });

  it('deduplicates offline POS batch sync and enforces loyalty RBAC (401/403)', async () => {
    const offlineClientOrderId = `POS01-${randomUUID().slice(0, 8)}`;
    const syncPayload = {
      orders: [
        {
          clientOrderId: offlineClientOrderId,
          posTerminalId: 'POS01',
          posReceiptNumber: 'POS01-0042',
          occurredAt: new Date().toISOString(),
          orderSource: 'POS',
          paymentMethod: 'CARD_TERMINAL',
          items: [
            {
              menuItemId: pizzaHutMenuItemId,
              quantity: 1,
            },
          ],
        },
      ],
    };

    const firstSync = await client.post<{
      syncedCount: number;
      results: Array<{
        clientOrderId: string;
        orderId: string;
      }>;
    }>('/api/pos/orders/sync', syncPayload, {
      token: cliftonOwnerToken,
    });
    expect(firstSync.status).toBe(200);
    expect(firstSync.body.syncedCount).toBe(1);
    const syncedOrderId = firstSync.body.results[0]?.orderId ?? '';
    expect(syncedOrderId).not.toBe('');

    const dupSync = await client.post<{
      syncedCount: number;
      results: Array<{
        clientOrderId: string;
        orderId: string;
      }>;
    }>('/api/pos/orders/sync', syncPayload, {
      token: cliftonOwnerToken,
    });
    expect(dupSync.status).toBe(200);
    expect(dupSync.body.syncedCount).toBe(0);
    expect(dupSync.body.results[0]?.orderId).toBe(syncedOrderId);

    const unauthLoyalty = await client.get<{
      code: string;
    }>('/api/loyalty/me');
    expect(unauthLoyalty.status).toBe(401);
    expect(unauthLoyalty.body.code).toBe('UNAUTHORIZED');

    const staffLoyalty = await client.get<{
      code: string;
    }>('/api/loyalty/me', {
      token: cliftonOwnerToken,
    });
    expect(staffLoyalty.status).toBe(403);
    expect(staffLoyalty.body.code).toBe('INSUFFICIENT_RIGHTS');
  });
});
