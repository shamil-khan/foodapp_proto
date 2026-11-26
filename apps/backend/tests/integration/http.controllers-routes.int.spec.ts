import { randomUUID } from 'node:crypto';
import { redisClient } from '@foodapp/db';
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

describe('http.controllers-routes — In-Process Controller, Middleware & Catalog/IAM/Billing/Loyalty Coverage', () => {
  const cliftonBranchId = 'b0000000-0000-4000-8000-000000000006';
  const edgbastonBranchId = 'b0000000-0000-4000-8000-000000000007';
  const menuItemId = 'e0000000-0000-4000-8000-000000000006';
  const tomStaffId = 'c0000000-0000-4000-8000-000000000007';
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

  it('exercises BrandController, CatalogController & PreviewOrderController in-process', async () => {
    const health = await app.request('/api/health');
    expect(health.status).toBe(200);

    const brands = await app.request('/api/brands?search=Pizza');
    expect(brands.status).toBe(200);

    const pizzaHut = await app.request('/api/brands/pizza-hut');
    expect(pizzaHut.status).toBe(200);

    const cliftonSlug = await app.request('/api/brands/pizza-hut/bristol/clifton');
    expect(cliftonSlug.status).toBe(200);

    const missingSlug = await app.request('/api/brands/pizza-hut/bristol/missing-slug');
    expect(missingSlug.status).toBe(404);

    const menu = await app.request(`/api/catalog/branches/${cliftonBranchId}/menu`);
    expect(menu.status).toBe(200);

    const taggedMenu = await app.request(
      `/api/catalog/branches/${cliftonBranchId}/menu?tag=cheese`,
    );
    expect(taggedMenu.status).toBe(200);

    const preview = await app.request('/api/orders/preview', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        branchId: cliftonBranchId,
        orderSource: 'ONLINE_DELIVERY',
        items: [
          {
            menuItemId,
            quantity: 1,
          },
        ],
      }),
    });
    expect(preview.status).toBe(200);

    const settings = await app.request(`/api/pos/brands/branches/${cliftonBranchId}/settings`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        supportsTakeaway: true,
        menuSelectionMode: 'ALL_BRAND_ITEMS',
      }),
    });
    expect(settings.status).toBe(200);

    const policy = await app.request('/api/pos/catalog/pricing-policy', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        menuPricingMode: 'THRESHOLD_HYBRID',
        maxDirectPriceDeltaPercent: 10,
        allowBranchLocalItems: true,
        maxDirectOrderDiscountPercent: 15,
        allowFullCompWaiveOff: false,
        requireReasonForCompOrDiscount: true,
        maxDirectRefundAmount: 25,
      }),
    });
    expect(policy.status).toBe(200);

    const override = await app.request(
      `/api/pos/catalog/branches/${cliftonBranchId}/menu/${menuItemId}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          isIncluded: true,
          isAvailable: true,
          proposedPrice: 16.49,
        }),
      },
    );
    expect(override.status).toBe(200);
  });

  it('exercises IamController, SupportController, OrderController, BillingController & LoyaltyController in-process', async () => {
    const me = await app.request('/api/me', {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(me.status).toBe(200);

    const rights = await app.request('/api/pos/roles/rights', {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(rights.status).toBe(200);

    const roles = await app.request('/api/pos/roles', {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(roles.status).toBe(200);

    const switched = await app.request('/api/pos/auth/switch-branch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        targetBranchId: edgbastonBranchId,
      }),
    });
    expect(switched.status).toBe(200);

    const createdRole = await app.request('/api/pos/roles', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        name: `COV_ROLE_${randomUUID().slice(0, 6)}`,
        permissions: [
          'orders:read',
          'orders:place',
        ],
      }),
    });
    expect(createdRole.status).toBe(201);
    const roleBody = (await createdRole.json()) as {
      roleId: string;
    };

    const updatedRole = await app.request(`/api/pos/roles/${roleBody.roleId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        permissions: [
          'orders:read',
        ],
      }),
    });
    expect(updatedRole.status).toBe(200);

    const deletedRole = await app.request(`/api/pos/roles/${roleBody.roleId}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(deletedRole.status).toBe(200);

    const ticketsList = await app.request('/api/pos/support-tickets', {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(ticketsList.status).toBe(200);

    const createdTicket = await app.request('/api/pos/support-tickets', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        scopePermission: 'platform:support:catalog-override',
        reason: 'In-process controller coverage test ticket',
        expiresInHours: 2,
      }),
    });
    expect(createdTicket.status).toBe(201);
    const ticketBody = (await createdTicket.json()) as {
      ticketId: string;
    };

    const revokedTicket = await app.request(
      `/api/pos/support-tickets/${ticketBody.ticketId}/revoke`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      },
    );
    expect(revokedTicket.status).toBe(200);

    const placed = await app.request('/api/pos/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        orderSource: 'DINE_IN',
        items: [
          {
            menuItemId,
            quantity: 1,
          },
        ],
      }),
    });
    expect(placed.status).toBe(201);
    const orderBody = (await placed.json()) as {
      orderId: string;
    };

    const orderList = await app.request('/api/pos/orders', {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(orderList.status).toBe(200);

    const orderDetail = await app.request(`/api/orders/${orderBody.orderId}`, {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(orderDetail.status).toBe(200);

    const settled = await app.request(`/api/pos/orders/${orderBody.orderId}/settle`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        paymentMethod: 'CARD_TERMINAL',
        tipAmount: 1.0,
      }),
    });
    expect(settled.status).toBe(200);

    const billing = await app.request('/api/billing/restaurant', {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(billing.status).toBe(200);

    const refund = await app.request('/api/billing/refunds', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        orderId: orderBody.orderId,
        amountGbp: '5.00',
        reason: 'Partial goodwill refund',
      }),
    });
    expect(refund.status).toBe(200);

    const gov = await app.request('/api/loyalty/governance', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        issuerScope: 'MERCHANT',
        status: 'ACTIVE',
        statusReason: 'In-process controller coverage verification',
      }),
    });
    expect(gov.status).toBe(200);

    expect(tomStaffId).toBeTruthy();
  });

  it('exercises POS offline sync, staff branch-access, merchant settle & logout routes in-process', async () => {
    const syncRes = await app.request('/api/pos/orders/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        orders: [
          {
            clientOrderId: `pos-cov-${randomUUID()}`,
            posTerminalId: 'POS-COV-01',
            posReceiptNumber: 'R-COV-01',
            occurredAt: new Date().toISOString(),
            orderSource: 'POS',
            paymentMethod: 'CASH',
            items: [
              {
                menuItemId,
                quantity: 1,
              },
            ],
          },
        ],
      }),
    });
    expect(syncRes.status).toBe(200);

    const rolesRes = await app.request('/api/pos/roles', {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    const rolesData = (await rolesRes.json()) as {
      roles: Array<{
        id: string;
        name: string;
      }>;
    };
    const ownerRoleId = rolesData.roles.find((r) => r.name === 'BRAND_OWNER')?.id ?? '';

    const assign = await app.request(`/api/pos/staff/${tomStaffId}/branch-access`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        branchId: cliftonBranchId,
        roleId: ownerRoleId,
      }),
    });
    expect(assign.status).toBe(200);

    const settleB2b = await app.request(
      '/api/billing/merchants/a0000000-0000-4000-8000-000000000005/settle',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          markPaidReference: `FPS-COV-${randomUUID().slice(0, 6)}`,
        }),
      },
    );
    expect([
      201,
      409,
    ]).toContain(settleB2b.status);

    const logout = await app.request('/api/pos/auth/logout', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(logout.status).toBe(200);
  });
});
