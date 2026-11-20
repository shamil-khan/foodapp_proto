import { beforeAll, describe, expect, it } from 'vitest';
import { ApiTestClient, loginPosStaff } from '../helpers/api-client.js';

interface MenuSnapshotResponse {
  categories: Array<{
    items: Array<{
      id: string;
    }>;
  }>;
}

describe('03 — POS Ordering, Settlement Saga, Double-Entry Ledger & Customer Loyalty', () => {
  const client = new ApiTestClient();
  const rest1Id = 'a0000000-0000-4000-8000-000000000001';
  const rest2Id = 'a0000000-0000-4000-8000-000000000002';
  const seededCustomerId = '11111111-1111-4111-8111-111111111111';

  let ownerToken = '';
  let takerToken = '';
  let otherTenantToken = '';
  let menuItemId = '';
  let rest1ItemId = '';
  let orderId = '';

  beforeAll(async () => {
    ownerToken = await loginPosStaff(client, {
      subdomain: 'westminster-patty',
      email: 'staff1.0002@pos-tenant.co.uk',
      password: 'Password123!',
    });

    takerToken = await loginPosStaff(client, {
      subdomain: 'westminster-patty',
      email: 'staff5.0002@pos-tenant.co.uk',
      password: 'Password123!',
    });

    otherTenantToken = await loginPosStaff(client, {
      subdomain: 'smash360',
      email: 'staff1.0001@pos-tenant.co.uk',
      password: 'Password123!',
    });

    const rest2Menu = await client.get<MenuSnapshotResponse>(`/api/restaurants/${rest2Id}/menu`);
    menuItemId = rest2Menu.body.categories[0]?.items[0]?.id ?? '';

    const rest1Menu = await client.get<MenuSnapshotResponse>(`/api/restaurants/${rest1Id}/menu`);
    rest1ItemId = rest1Menu.body.categories[0]?.items[0]?.id ?? '';
  });

  it('3.1 Places a POS order with customerId and returns KDS station slips (201)', async () => {
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
            menuItemId,
            quantity: 2,
          },
        ],
      },
      {
        token: ownerToken,
      },
    );

    expect(res.status).toBe(201);
    expect(res.body.orderId).toBeTruthy();
    expect(res.body.kdsTickets.orderId).toBe(res.body.orderId);
    orderId = res.body.orderId;
  });

  it('3.2 Blocks cross-tenant order query, settle, and foreign item injection (403 TENANT_FORBIDDEN)', async () => {
    const crossQuery = await client.get<{
      code: string;
    }>(`/api/pos/orders?restaurantId=${rest1Id}`, {
      token: ownerToken,
    });
    expect(crossQuery.status).toBe(403);
    expect(crossQuery.body.code).toBe('TENANT_FORBIDDEN');

    const crossSettle = await client.post<{
      code: string;
    }>(
      `/api/pos/orders/${orderId}/settle`,
      {
        paymentMethod: 'CASH',
        tipAmount: 0,
      },
      {
        token: otherTenantToken,
      },
    );
    expect(crossSettle.status).toBe(403);
    expect(crossSettle.body.code).toBe('TENANT_FORBIDDEN');

    const foreignItem = await client.post<{
      code: string;
    }>(
      '/api/pos/orders',
      {
        orderSource: 'DINE_IN',
        items: [
          {
            menuItemId: rest1ItemId,
            quantity: 1,
          },
        ],
      },
      {
        token: ownerToken,
      },
    );
    expect(foreignItem.status).toBe(403);
    expect(foreignItem.body.code).toBe('TENANT_FORBIDDEN');
  });

  it('3.3 Blocks ORDER_TAKER from settling orders or reading ledger (403 INSUFFICIENT_RIGHTS)', async () => {
    const settleDenied = await client.post<{
      code: string;
    }>(
      `/api/pos/orders/${orderId}/settle`,
      {
        paymentMethod: 'CASH',
        tipAmount: 0,
      },
      {
        token: takerToken,
      },
    );
    expect(settleDenied.status).toBe(403);
    expect(settleDenied.body.code).toBe('INSUFFICIENT_RIGHTS');

    const ledgerDenied = await client.get<{
      code: string;
    }>('/api/ledger/restaurant', {
      token: takerToken,
    });
    expect(ledgerDenied.status).toBe(403);
    expect(ledgerDenied.body.code).toBe('INSUFFICIENT_RIGHTS');
  });

  it('3.4 Settles order (200), verifies ledger entry (200), and blocks duplicate settle (400 ALREADY_SETTLED)', async () => {
    const settled = await client.post(
      `/api/pos/orders/${orderId}/settle`,
      {
        paymentMethod: 'CASH',
        tipAmount: 1.5,
      },
      {
        token: ownerToken,
      },
    );
    expect(settled.status).toBe(200);

    const ledger = await client.get<{
      entries: Array<{
        orderId: string;
      }>;
    }>('/api/ledger/restaurant', {
      token: ownerToken,
    });
    expect(ledger.status).toBe(200);
    expect(ledger.body.entries.some((e) => e.orderId === orderId)).toBe(true);

    const ordersList = await client.get<{
      orders: Array<{
        id: string;
      }>;
    }>('/api/pos/orders', {
      token: ownerToken,
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
        token: ownerToken,
      },
    );
    expect(duplicateSettle.status).toBe(400);
    expect(duplicateSettle.body.code).toBe('ALREADY_SETTLED');
  });

  it('3.5 Enforces authentication (401) and customer-only RBAC (403) on loyalty endpoints', async () => {
    const unauth = await client.get<{
      code: string;
    }>('/api/ledger/loyalty/me');
    expect(unauth.status).toBe(401);
    expect(unauth.body.code).toBe('UNAUTHORIZED');

    const staffForbidden = await client.get<{
      code: string;
    }>('/api/ledger/loyalty/me', {
      token: ownerToken,
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
        token: ownerToken,
      },
    );
    expect(redeemForbidden.status).toBe(403);
    expect(redeemForbidden.body.code).toBe('INSUFFICIENT_RIGHTS');
  });
});
