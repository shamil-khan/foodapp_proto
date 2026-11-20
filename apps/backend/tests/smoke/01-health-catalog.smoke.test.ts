import { beforeAll, describe, expect, it } from 'vitest';
import { ApiTestClient, loginPosStaff } from '../helpers/api-client.js';

interface MenuSnapshotResponse {
  restaurantId: string;
  versionHash: string;
  categories: Array<{
    items: Array<{
      id: string;
      basePrice: number;
    }>;
  }>;
}

describe('01 — Platform Health, OpenAPI & Subdomain Catalog', () => {
  const client = new ApiTestClient();
  const rest1Id = 'a0000000-0000-4000-8000-000000000001';
  const rest2Id = 'a0000000-0000-4000-8000-000000000002';

  let ownerToken = '';
  let takerToken = '';
  let rest1ItemId = '';
  let rest2ItemId = '';

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
  });

  it('1.1 GET /api/health and GET /api/doc return 200 OK', async () => {
    const health = await client.get<{
      status: string;
      service: string;
    }>('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.service).toBe('foodapp-backend');

    const doc = await client.get<{
      openapi: string;
    }>('/api/doc');
    expect(doc.status).toBe(200);
    expect(doc.body.openapi).toBe('3.1.0');
  });

  it('1.2–1.3 Lists restaurants with filters (200) and resolves subdomain (200 / 404)', async () => {
    const list = await client.get<{
      restaurants: Array<{
        subdomain: string;
      }>;
    }>('/api/restaurants?postcodeSector=SW1A&search=Westminster');
    expect(list.status).toBe(200);
    expect(list.body.restaurants.some((r) => r.subdomain === 'westminster-patty')).toBe(true);

    const found = await client.get<{
      restaurant: {
        id: string;
        subdomain: string;
      };
    }>('/api/restaurants/by-subdomain/westminster-patty');
    expect(found.status).toBe(200);
    expect(found.body.restaurant.id).toBe(rest2Id);

    const missing = await client.get<{
      code: string;
    }>('/api/restaurants/by-subdomain/non-existent-tenant');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });

  it('1.4 Fetches compiled menu snapshots (200) and returns 404 on unknown restaurant', async () => {
    const snap2 = await client.get<MenuSnapshotResponse>(`/api/restaurants/${rest2Id}/menu`);
    expect(snap2.status).toBe(200);
    rest2ItemId = snap2.body.categories?.[0]?.items?.[0]?.id ?? '';
    expect(rest2ItemId).toBeTruthy();

    const snap1 = await client.get<MenuSnapshotResponse>(`/api/restaurants/${rest1Id}/menu`);
    expect(snap1.status).toBe(200);
    rest1ItemId = snap1.body.categories?.[0]?.items?.[0]?.id ?? '';

    const missingSnap = await client.get(
      '/api/restaurants/00000000-0000-4000-8000-999999999999/menu',
    );
    expect(missingSnap.status).toBe(404);
  });

  it('1.5 Updates item price (200), invalidates cache, and enforces optimistic locking (409) & RBAC (403)', async () => {
    // Missing catalog:price:update right -> 403
    const deniedRight = await client.patch<{
      code: string;
    }>(
      `/api/restaurants/items/${rest2ItemId}/price`,
      {
        newBasePrice: 9.99,
        expectedRowVersion: 1,
      },
      {
        token: takerToken,
      },
    );
    expect(deniedRight.status).toBe(403);
    expect(deniedRight.body.code).toBe('INSUFFICIENT_RIGHTS');

    // Cross-tenant item -> 403 TENANT_FORBIDDEN
    const crossTenant = await client.patch<{
      code: string;
    }>(
      `/api/restaurants/items/${rest1ItemId}/price`,
      {
        newBasePrice: 9.99,
        expectedRowVersion: 1,
      },
      {
        token: ownerToken,
      },
    );
    expect(crossTenant.status).toBe(403);
    expect(crossTenant.body.code).toBe('TENANT_FORBIDDEN');

    // Happy path update -> 200 OK (bumps rowVersion from 1 to 2)
    // apps/backend/tests/smoke/01-health-catalog.smoke.test.ts
    // Happy path update -> 200 OK (handles repeated runs without db:reset)
    let activeVersion = 1;
    let updated = await client.patch<{
      success: boolean;
    }>(
      `/api/restaurants/items/${rest2ItemId}/price`,
      {
        newBasePrice: 9.49,
        expectedRowVersion: activeVersion,
      },
      {
        token: ownerToken,
      },
    );

    if (updated.status === 409) {
      // Already bumped in a previous test run; probe next version up to 20
      for (let v = 2; v <= 20; v++) {
        const retry = await client.patch<{
          success: boolean;
        }>(
          `/api/restaurants/items/${rest2ItemId}/price`,
          {
            newBasePrice: 9.49,
            expectedRowVersion: v,
          },
          {
            token: ownerToken,
          },
        );
        if (retry.status === 200) {
          updated = retry;
          activeVersion = v;
          break;
        }
      }
    }

    expect(updated.status).toBe(200);
    expect(updated.body.success).toBe(true);

    // Stale activeVersion -> 409 CONCURRENCY_CONFLICT
    const conflict = await client.patch<{
      code: string;
    }>(
      `/api/restaurants/items/${rest2ItemId}/price`,
      {
        newBasePrice: 10.49,
        expectedRowVersion: activeVersion,
      },
      {
        token: ownerToken,
      },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('CONCURRENCY_CONFLICT');
  });
});
