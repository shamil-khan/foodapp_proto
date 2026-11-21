import { beforeAll, describe, expect, it } from 'vitest';
import { ApiTestClient, loginPosStaff } from '../helpers/api-client.js';

describe('05 — Multi-Branch POS Ordering, Ledger Saga & Customer Loyalty', () => {
  const client = new ApiTestClient();
  const cliftonBranchId = 'b0000000-0000-4000-8000-000000000006';
  const gulbergBranchId = 'b0000000-0000-4000-8000-000000000007';
  const pizzaHutMenuItemId = 'e0000000-0000-4000-8000-000000000006';
  const pizzaInMenuItemId = 'e0000000-0000-4000-8000-000000000004';
  const seededCustomerId = '11111111-1111-4111-8111-111111111111';

  let cliftonOwnerToken = '';
  let gulbergOwnerToken = '';
  let orderId = '';

  beforeAll(async () => {
    cliftonOwnerToken = await loginPosStaff(client, {
      brandHandle: 'pizza-hut',
      email: 'owner@pizza-hut.example.com',
      password: 'Password123!',
      branchId: cliftonBranchId,
    });

    gulbergOwnerToken = await loginPosStaff(client, {
      brandHandle: 'pizza-hut',
      email: 'owner@pizza-hut.example.com',
      password: 'Password123!',
      branchId: gulbergBranchId,
    });
  });

  it('10.1 Places POS order on active branch with customerId and returns KDS tickets (201)', async () => {
    const res = await client.post<{
      orderId: string;
      kdsTickets: {
        orderId: string;
        stationSlips: Record<string, unknown[]>;
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

    expect(res.status).toBe(201);
    expect(res.body.orderId).toBeTruthy();
    expect(res.body.kdsTickets.orderId).toBe(res.body.orderId);
    orderId = res.body.orderId;
  });

  it('10.2 Blocks cross-branch order query/settle (403 BRANCH_FORBIDDEN) & foreign item injection (403 TENANT_FORBIDDEN)', async () => {
    const crossBranchQuery = await client.get<{
      code: string;
    }>(`/api/pos/orders?restaurantId=${gulbergBranchId}`, {
      token: cliftonOwnerToken,
    });
    expect(crossBranchQuery.status).toBe(403);
    expect(crossBranchQuery.body.code).toBe('BRANCH_FORBIDDEN');

    const crossBranchSettle = await client.post<{
      code: string;
    }>(
      `/api/pos/orders/${orderId}/settle`,
      {
        paymentMethod: 'CASH',
        tipAmount: 0,
      },
      {
        token: gulbergOwnerToken,
      },
    );
    expect(crossBranchSettle.status).toBe(403);
    expect(crossBranchSettle.body.code).toBe('BRANCH_FORBIDDEN');

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
  });

  it('10.3 Settles order (200), records double-entry ledger (200), and blocks duplicate settle (400 ALREADY_SETTLED)', async () => {
    const settled = await client.post(
      `/api/pos/orders/${orderId}/settle`,
      {
        paymentMethod: 'CASH',
        tipAmount: 1.5,
      },
      {
        token: cliftonOwnerToken,
      },
    );
    expect(settled.status).toBe(200);

    const ledger = await client.get<{
      entries: Array<{
        orderId: string;
      }>;
    }>('/api/ledger/restaurant', {
      token: cliftonOwnerToken,
    });
    expect(ledger.status).toBe(200);
    expect(ledger.body.entries.some((e) => e.orderId === orderId)).toBe(true);

    const ordersList = await client.get<{
      orders: Array<{
        id: string;
      }>;
    }>(`/api/pos/orders?restaurantId=${cliftonBranchId}`, {
      token: cliftonOwnerToken,
    });
    expect(ordersList.status).toBe(200);
    expect(ordersList.body.orders.some((o) => o.id === orderId)).toBe(true);

    const duplicateSettle = await client.post<{
      code: string;
    }>(
      `/api/pos/orders/${orderId}/settle`,
      {
        paymentMethod: 'CASH',
        tipAmount: 0,
      },
      {
        token: cliftonOwnerToken,
      },
    );
    expect(duplicateSettle.status).toBe(400);
    expect(duplicateSettle.body.code).toBe('ALREADY_SETTLED');
  });

  it('10.4 Enforces authentication (401) and customer-only RBAC (403) on loyalty endpoints', async () => {
    const unauth = await client.get<{
      code: string;
    }>('/api/ledger/loyalty/me');
    expect(unauth.status).toBe(401);
    expect(unauth.body.code).toBe('UNAUTHORIZED');

    const staffForbidden = await client.get<{
      code: string;
    }>('/api/ledger/loyalty/me', {
      token: cliftonOwnerToken,
    });
    expect(staffForbidden.status).toBe(403);
    expect(staffForbidden.body.code).toBe('INSUFFICIENT_RIGHTS');

    const redeemForbidden = await client.post<{
      code: string;
    }>(
      '/api/ledger/loyalty/redeem',
      {
        pointsToRedeem: 50,
      },
      {
        token: cliftonOwnerToken,
      },
    );
    expect(redeemForbidden.status).toBe(403);
    expect(redeemForbidden.body.code).toBe('INSUFFICIENT_RIGHTS');
  });
});
