import { randomUUID } from 'node:crypto';
import { CUSTOMER_PERMISSIONS, redisClient, SYSTEM_ROLE_DEFINITIONS } from '@foodapp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rootContainer } from '@/container';
import { AppLogger } from '@/logger';

describe('mobile.sse-reconnect — Mobile SSE Stream & Last-Event-ID Replay', () => {
  const restaurantId = 'a0000000-0000-4000-8000-000000000005';
  const branchId = 'b0000000-0000-4000-8000-000000000007';
  const menuItemId = 'e0000000-0000-4000-8000-000000000006';
  const customerId = '11111111-1111-4111-8111-111111111111';
  const tomStaffId = 'c0000000-0000-4000-8000-000000000007';

  beforeAll(async () => {
    if (!redisClient.isOpen) await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient.isOpen) await redisClient.quit();
  });

  it('replays missed status events in strict sequence order when reconnecting with Last-Event-ID', async () => {
    const customerScope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: customerId,
        actorSource: 'CUSTOMER',
        permissions: CUSTOMER_PERMISSIONS,
      },
      log: new AppLogger('int-sse-customer'),
    });

    const branchScope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: tomStaffId,
        actorSource: 'POS_STAFF',
        restaurantId,
        branchId,
        permissions: SYSTEM_ROLE_DEFINITIONS.BRAND_OWNER.permissions,
      },
      log: new AppLogger('int-sse-branch'),
    });

    try {
      const checkout = await customerScope.get('commandBus').dispatch<{
        ok: boolean;
        value?: {
          orderId: string;
        };
      }>('CheckoutOrder', {
        branchId,
        orderSource: 'ONLINE_DELIVERY',
        paymentMode: 'ONLINE_GATEWAY',
        paymentToken: 'tok_visa_approved',
        items: [
          {
            menuItemId,
            quantity: 1,
          },
        ],
      });
      expect(checkout.ok).toBe(true);
      if (!checkout.ok || !checkout.value) return;

      const orderId = checkout.value.orderId;
      const branchBus = branchScope.get('commandBus');
      for (const toStatus of [
        'ACCEPTED',
        'PREPARING',
        'READY_FOR_PICKUP',
        'OUT_FOR_DELIVERY',
      ] as const) {
        const tr = await branchBus.dispatch<{
          ok: boolean;
        }>('TransitionOrderStatus', {
          orderId,
          toStatus,
        });
        expect(tr.ok).toBe(true);
      }

      const queryBus = branchScope.get('queryBus');
      const allEvents = await queryBus.ask<
        Array<{
          eventId: string;
          version: number;
          eventType: string;
        }>
      >('GetOrderEventsSince', {
        orderId,
        afterVersion: 0,
      });
      expect(allEvents.length).toBeGreaterThanOrEqual(8);

      const missed = await queryBus.ask<
        Array<{
          eventId: string;
          version: number;
          eventType: string;
        }>
      >('GetOrderEventsSince', {
        orderId,
        afterVersion: 5,
      });
      expect(missed.length).toBe(allEvents.length - 5);
      expect(missed[0]?.version).toBe(6);

      const latestVersion = allEvents[allEvents.length - 1]?.version ?? 99;
      const emptyReplay = await queryBus.ask<unknown[]>('GetOrderEventsSince', {
        orderId,
        afterVersion: latestVersion,
      });
      expect(emptyReplay).toHaveLength(0);
    } finally {
      await customerScope.dispose();
      await branchScope.dispose();
    }
  });
});
