// FILE: apps/backend/tests/unit/shared.route-auth-guards.spec.ts (Part 1 of 2)
import { SYSTEM_ACTORS } from '@foodapp/db';
import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import { billingRoutes } from '@/billing/services/billing-routes';
import { adminBrandRoutes, brandRoutes, posBrandRoutes } from '@/brand/services/brand-routes';
import { catalogRoutes, posCatalogRoutes } from '@/catalog/services/catalog-routes';
import type { AppEnv } from '@/container';
import {
  AuthorizationPolicy,
  type RequestContext,
  resolveDefaultPermissionsForActor,
} from '@/core/application/authorization';
import { iamRoutes } from '@/iam/services/iam-routes';
import { loyaltyRoutes } from '@/loyalty/services/loyalty-routes';
import { createPosOrderRoutes, createStorefrontOrderRoutes } from '@/orders/services/order-routes';
import { supportRoutes } from '@/support/services/support-routes';
import { InMemoryIdempotencyStore } from '../fakes/in-memory-idempotency-store';

function buildAppWithActor(actor: RequestContext) {
  const app = new OpenAPIHono<AppEnv>();
  const store = new InMemoryIdempotencyStore();

  app.use('/api/*', async (c, next) => {
    const authz = new AuthorizationPolicy(actor);
    c.set('di', {
      get: (key: string) => {
        if (key === 'request') return actor;
        if (key === 'authz') return authz;
        throw new Error(`Unexpected controller resolution on guarded route: ${key}`);
      },
    } as unknown as AppEnv['Variables']['di']);
    await next();
  });

  app.route('/api', iamRoutes);
  app.route('/api/pos/support-tickets', supportRoutes);
  app.route('/api/brands', brandRoutes);
  app.route('/api/pos/brands', posBrandRoutes);
  app.route('/api/admin', adminBrandRoutes);
  app.route('/api/catalog', catalogRoutes);
  app.route('/api/pos/catalog', posCatalogRoutes);
  app.route('/api/orders', createStorefrontOrderRoutes(store));
  app.route('/api/pos/orders', createPosOrderRoutes(store));
  app.route('/api/billing', billingRoutes);
  app.route('/api/loyalty', loyaltyRoutes);

  return app;
}
// FILE: apps/backend/tests/unit/shared.route-auth-guards.spec.ts (Part 2 of 2)
describe('shared.route-auth-guards — Fail-Fast 401 & Three-Actor 403 Isolation', () => {
  const sampleUuid = '00000000-0000-4000-8000-000000000001';

  it('returns 401 Unauthorized on all protected POS, Support, Brand, Catalog, Billing, Loyalty & Order routes when unauthenticated', async () => {
    const app = buildAppWithActor({
      requestId: 'req-unauth',
      actorId: SYSTEM_ACTORS.SYSTEM_CRON,
      actorSource: 'SYSTEM',
      permissions: [],
    });

    const protectedRequests: Array<
      [
        string,
        string,
        unknown?,
      ]
    > = [
      [
        'GET',
        '/api/pos/orders',
      ],
      [
        'GET',
        `/api/pos/orders?restaurantId=${sampleUuid}`,
      ],
      [
        'POST',
        '/api/pos/orders',
        {},
      ],
      [
        'POST',
        `/api/pos/orders/${sampleUuid}/settle`,
        {},
      ],
      [
        'POST',
        '/api/pos/orders/sync',
        {},
      ],
      [
        'GET',
        `/api/orders/${sampleUuid}`,
      ],
      [
        'GET',
        `/api/orders/${sampleUuid}/stream`,
      ],
      [
        'PATCH',
        `/api/orders/${sampleUuid}/status`,
        {},
      ],
      [
        'POST',
        '/api/pos/support-tickets',
        {},
      ],
      [
        'GET',
        '/api/pos/support-tickets',
      ],
      [
        'PATCH',
        `/api/pos/support-tickets/${sampleUuid}/revoke`,
      ],
      [
        'POST',
        '/api/pos/brands/branches',
        {},
      ],
      [
        'PATCH',
        `/api/pos/brands/branches/${sampleUuid}/status`,
        {},
      ],
      [
        'PATCH',
        `/api/pos/brands/branches/${sampleUuid}/settings`,
        {},
      ],
      [
        'POST',
        `/api/pos/brands/branches/${sampleUuid}/whitelist`,
        {},
      ],
      [
        'PUT',
        '/api/pos/catalog/pricing-policy',
        {},
      ],
      [
        'PUT',
        `/api/pos/catalog/branches/${sampleUuid}/menu/${sampleUuid}`,
        {},
      ],
      [
        'POST',
        `/api/pos/catalog/branches/${sampleUuid}/menu/${sampleUuid}/review`,
        {},
      ],
      [
        'POST',
        '/api/pos/catalog/items',
        {},
      ],
      [
        'POST',
        `/api/billing/merchants/${sampleUuid}/settle`,
        {},
      ],
      [
        'PATCH',
        '/api/loyalty/governance',
        {},
      ],
      [
        'POST',
        `/api/loyalty/entries/${sampleUuid}/audit`,
        {},
      ],
      [
        'POST',
        '/api/pos/auth/switch-branch',
        {},
      ],
    ];

    for (const [method, path, body] of protectedRequests) {
      const res = await app.request(path, {
        method,
        headers: body
          ? {
              'Content-Type': 'application/json',
            }
          : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status, `${method} ${path} should return 401`).toBe(401);
    }
  });

  it('blocks POS_STAFF and PLATFORM_ADMIN from placing customer orders or creating support tickets unilaterally (403)', async () => {
    const posApp = buildAppWithActor({
      requestId: 'req-pos',
      actorId: 'staff-1',
      actorSource: 'POS_STAFF',
      restaurantId: 'rest-1',
      branchId: 'branch-1',
      permissions: [
        'orders:read',
        'orders:place',
        'orders:settle',
      ],
    });
    const posCheckout = await posApp.request('/api/orders/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(posCheckout.status).toBe(403);

    const adminApp = buildAppWithActor({
      requestId: 'req-admin',
      actorId: 'admin-1',
      actorSource: 'GLOBAL_USER',
      globalRole: 'PLATFORM_ADMIN',
      permissions: resolveDefaultPermissionsForActor({
        actorSource: 'GLOBAL_USER',
        globalRole: 'PLATFORM_ADMIN',
      }),
    });
    const adminCreateTicket = await adminApp.request('/api/pos/support-tickets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(adminCreateTicket.status).toBe(403);

    const adminBranchWithoutTicket = await adminApp.request(
      `/api/pos/brands/branches/${sampleUuid}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operationalStatus: 'OPEN',
        }),
      },
    );
    expect(adminBranchWithoutTicket.status).toBe(403);
  });
});
