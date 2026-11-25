import { randomUUID } from 'node:crypto';
import { pgPool, redisClient, SYSTEM_ACTORS } from '@foodapp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rootContainer } from '@/container';
import { AppLogger } from '@/logger';

describe('brand-catalog.onboarding-sync-saga — All-or-Nothing Onboarding Rollback & BranchCatalogSyncSaga', () => {
  beforeAll(async () => {
    if (!redisClient.isOpen) await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient.isOpen) await redisClient.quit();
  });

  it('rolls back all brand, iam, and catalog rows when BrandOnboardingStepFailed fires so handle can be retried', async () => {
    const scope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: SYSTEM_ACTORS.SYSTEM_CRON,
        actorSource: 'SYSTEM',
        permissions: [],
      },
      log: new AppLogger('int-brand-onboarding-rollback'),
    });

    try {
      const handle = `rollback-brand-${Date.now()}`;
      const reg = await scope.get('commandBus').dispatch<{
        ok: boolean;
        value?: {
          restaurantId: string;
          branchId: string;
          ownerStaffId: string;
        };
      }>('RegisterBrand', {
        brandName: 'Rollback Test Kitchen',
        handle,
        kitchenType: 'HOME_KITCHEN',
        branchName: 'Rollback Branch',
        city: 'London',
        postcodeSector: 'E1',
        streetAddress: '14 Brick Lane, London E1 6RF',
        contactPersonName: 'Nadia',
        contactPersonPhone: '+44-20-7946-0999',
        ownerName: 'Nadia',
        ownerEmail: `nadia-${Date.now()}@example.com`,
        ownerPassword: 'Password123!',
      });
      expect(reg.ok).toBe(true);
      if (!reg.ok || !reg.value) return;

      const { restaurantId, branchId, ownerStaffId } = reg.value;

      // Simulate downstream failure and verify all-or-nothing hard-delete compensation
      await scope.get('eventBus').publish([
        {
          eventId: randomUUID(),
          aggregateId: restaurantId,
          aggregateType: 'CatalogOnboarding',
          eventType: 'BrandOnboardingStepFailed',
          version: 1,
          occurredAt: new Date(),
          payload: {
            restaurantId,
            branchId,
            ownerStaffId,
            failedStep: 'CATALOG_INITIALIZATION',
            reason: 'Simulated catalog initialization failure',
          },
          metadata: {
            actorId: SYSTEM_ACTORS.SYSTEM_CRON,
            restaurantId,
          },
        },
      ]);

      const restCount = await pgPool.query<{
        count: string;
      }>(`SELECT count(*)::text FROM "Restaurant" WHERE "id" = $1`, [
        restaurantId,
      ]);
      const staffCount = await pgPool.query<{
        count: string;
      }>(`SELECT count(*)::text FROM "RestaurantStaff" WHERE "id" = $1`, [
        ownerStaffId,
      ]);
      const policyCount = await pgPool.query<{
        count: string;
      }>(`SELECT count(*)::text FROM "PricingPolicy" WHERE "restaurantId" = $1`, [
        restaurantId,
      ]);

      expect(Number(restCount.rows[0]?.count)).toBe(0);
      expect(Number(staffCount.rows[0]?.count)).toBe(0);
      expect(Number(policyCount.rows[0]?.count)).toBe(0);
    } finally {
      await scope.dispose();
    }
  });
});
