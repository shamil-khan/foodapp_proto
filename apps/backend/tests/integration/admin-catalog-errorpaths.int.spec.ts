import { randomUUID } from 'node:crypto';
import {
  CUSTOMER_PERMISSIONS,
  PLATFORM_ADMIN_PERMISSIONS,
  pgPool,
  redisClient,
  SYSTEM_ROLE_DEFINITIONS,
} from '@foodapp/db';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rootContainer } from '@/container';
import { globalErrorHandler } from '@/errorHandler';
import { BadRequestError, NotFoundError } from '@/errors';
import { AppLogger } from '@/logger';
import { LoyaltyController } from '@/loyalty/services/loyalty-controller';

describe('admin-catalog-errorpaths — Admin Brand Provisioning, Catalog Price Sync, RedisIdempotencyStore & ErrorHandler', () => {
  const restaurantId = 'a0000000-0000-4000-8000-000000000005';
  const cliftonBranchId = 'b0000000-0000-4000-8000-000000000006';
  const menuItemId = 'e0000000-0000-4000-8000-000000000006';
  const platformAdminId = '00000000-0000-4000-8000-000000000001';
  const customerId = '11111111-1111-4111-8111-111111111111';
  const tomStaffId = 'c0000000-0000-4000-8000-000000000007';

  beforeAll(async () => {
    if (!redisClient.isOpen) await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient.isOpen) await redisClient.quit();
  });

  it('exercises CreateRestaurantByAdminHandler & UpdateRestaurantStatusByAdminHandler with PLATFORM_ADMIN_PERMISSIONS', async () => {
    const scope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: platformAdminId,
        actorSource: 'PLATFORM_STAFF',
        permissions: PLATFORM_ADMIN_PERMISSIONS,
      },
      log: new AppLogger('int-admin-brand'),
    });

    try {
      const handle = `admin-prov-${Date.now()}`;
      const created = await scope.get('commandBus').dispatch<{
        ok: boolean;
        value?: {
          restaurantId: string;
          brandHandle: string;
        };
      }>('CreateRestaurantByAdmin', {
        name: 'Admin Provisioned Grill',
        handle,
        kitchenType: 'CLOUD_KITCHEN',
        city: 'Manchester',
        postcodeSector: 'M1',
        streetAddress: '45 Deansgate, Manchester M3 2AY',
        contactPersonName: 'Omar',
        contactPersonPhone: '+44-161-496-0111',
        ownerName: 'Omar',
        ownerEmail: `omar-${Date.now()}@example.com`,
        ownerPassword: 'Password123!',
      });
      expect(created.ok).toBe(true);
      if (!created.ok || !created.value) return;

      const suspend = await scope.get('commandBus').dispatch<{
        ok: boolean;
      }>('UpdateRestaurantStatusByAdmin', {
        restaurantId: created.value.restaurantId,
        isActive: false,
      });
      expect(suspend.ok).toBe(true);

      const reactivate = await scope.get('commandBus').dispatch<{
        ok: boolean;
      }>('UpdateRestaurantStatusByAdmin', {
        restaurantId: created.value.restaurantId,
        isActive: true,
      });
      expect(reactivate.ok).toBe(true);

      const missing = await scope.get('commandBus').dispatch<{
        ok: boolean;
      }>('UpdateRestaurantStatusByAdmin', {
        restaurantId: '00000000-0000-4000-8000-999999999999',
        isActive: false,
      });
      expect(missing.ok).toBe(false);
    } finally {
      await scope.dispose();
    }
  });
  it('exercises UpdateMenuItemPriceHandler optimistic locking & BranchCatalogSyncSaga snapshot rebuild', async () => {
    const scope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: tomStaffId,
        actorSource: 'POS_STAFF',
        restaurantId,
        branchId: cliftonBranchId,
        permissions: SYSTEM_ROLE_DEFINITIONS.BRAND_OWNER.permissions,
      },
      log: new AppLogger('int-catalog-price'),
    });

    try {
      const verRes = await pgPool.query<{
        rowVersion: number;
        basePrice: string;
      }>(`SELECT "rowVersion", "basePrice"::text FROM "MenuItem" WHERE "id" = $1`, [
        menuItemId,
      ]);
      const currentVersion = Number(verRes.rows[0]?.rowVersion ?? 1);
      const originalPrice = Number(verRes.rows[0]?.basePrice ?? 15.99);

      const negRes = await scope.get('commandBus').dispatch<{
        ok: boolean;
      }>('UpdateMenuItemPrice', {
        branchId: cliftonBranchId,
        menuItemId,
        newBasePrice: -5,
        expectedRowVersion: currentVersion,
      });
      expect(negRes.ok).toBe(false);

      const okRes = await scope.get('commandBus').dispatch<{
        ok: boolean;
      }>('UpdateMenuItemPrice', {
        branchId: cliftonBranchId,
        menuItemId,
        newBasePrice: originalPrice + 1,
        expectedRowVersion: currentVersion,
      });
      expect(okRes.ok).toBe(true);

      const staleRes = await scope.get('commandBus').dispatch<{
        ok: boolean;
      }>('UpdateMenuItemPrice', {
        branchId: cliftonBranchId,
        menuItemId,
        newBasePrice: originalPrice,
        expectedRowVersion: currentVersion,
      });
      expect(staleRes.ok).toBe(false);

      const restoreRes = await scope.get('commandBus').dispatch<{
        ok: boolean;
      }>('UpdateMenuItemPrice', {
        branchId: cliftonBranchId,
        menuItemId,
        newBasePrice: originalPrice,
        expectedRowVersion: currentVersion + 1,
      });
      expect(restoreRes.ok).toBe(true);

      const idempStore = scope.get('idempotencyStore');
      const testKey = `cov-idemp-${randomUUID()}`;
      expect(await idempStore.acquireLock(testKey, 10)).toBe(true);
      expect(await idempStore.acquireLock(testKey, 10)).toBe(false);
      await idempStore.saveRecord(
        testKey,
        {
          requestHash: 'abc',
          status: 201,
          body: {
            ok: true,
          },
        },
        10,
      );
      expect((await idempStore.getRecord(testKey))?.status).toBe(201);
      await idempStore.releaseLock(testKey);
    } finally {
      await scope.dispose();
    }
  });

  it('exercises LoyaltyController.getMyWallet with CUSTOMER_PERMISSIONS and globalErrorHandler', async () => {
    const customerScope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: customerId,
        actorSource: 'CUSTOMER',
        permissions: CUSTOMER_PERMISSIONS,
      },
      log: new AppLogger('int-customer-loyalty'),
    });

    try {
      const controller = new LoyaltyController(
        customerScope.get('commandBus'),
        customerScope.get('queryBus'),
        customerScope.get('request'),
      );
      const fakeCtx = {
        json: (body: unknown, status: number) => ({
          body,
          status,
        }),
      };
      const res = (await controller.getMyWallet(fakeCtx as never, {
        scope: 'PLATFORM',
      })) as unknown as {
        status: number;
      };
      expect(res.status).toBe(200);
    } finally {
      await customerScope.dispose();
    }

    const errApp = new Hono();
    errApp.onError(globalErrorHandler as never);
    errApp.get('/not-found', () => {
      throw new NotFoundError('Missing entity');
    });
    errApp.get('/bad-req', () => {
      throw new BadRequestError('Bad input');
    });
    errApp.get('/boom', () => {
      throw new Error('Unexpected failure');
    });

    expect((await errApp.request('/not-found')).status).toBe(404);
    expect((await errApp.request('/bad-req')).status).toBe(400);
    expect((await errApp.request('/boom')).status).toBe(500);
  });
});
