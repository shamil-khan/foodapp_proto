import { randomUUID } from 'node:crypto';
import { CUSTOMER_PERMISSIONS, pgPool, redisClient, SYSTEM_ROLE_DEFINITIONS } from '@foodapp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rootContainer } from '@/container';
import { AppLogger } from '@/logger';

describe('delivery.3pl-webhooks — Inbound Courier Webhook & Payload Snapshot Audit', () => {
  const restaurantId = 'a0000000-0000-4000-8000-000000000003';
  const branchId = 'b0000000-0000-4000-8000-000000000003';
  const menuItemId = 'e0000000-0000-4000-8000-000000000003';
  const customerId = '11111111-1111-4111-8111-111111111111';
  const leoStaffId = 'c0000000-0000-4000-8000-000000000003';

  beforeAll(async () => {
    if (!redisClient.isOpen) await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient.isOpen) await redisClient.quit();
  });

  it('normalizes courier delivery webhook into COMPLETED status and rejects invalid transition jumps', async () => {
    const customerScope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: customerId,
        actorSource: 'CUSTOMER',
        permissions: CUSTOMER_PERMISSIONS,
      },
      log: new AppLogger('int-3pl-customer'),
    });

    const branchScope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: leoStaffId,
        actorSource: 'POS_STAFF',
        restaurantId,
        branchId,
        permissions: SYSTEM_ROLE_DEFINITIONS.BRAND_OWNER.permissions,
      },
      log: new AppLogger('int-3pl-branch'),
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

      const illegalJump = await branchBus.dispatch<{
        ok: boolean;
      }>('TransitionOrderStatus', {
        orderId,
        toStatus: 'COMPLETED',
      });
      expect(illegalJump.ok).toBe(false);

      for (const toStatus of [
        'ACCEPTED',
        'PREPARING',
        'PACKING',
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

      const externalDeliveryId = `stuart_job_${randomUUID().slice(0, 10)}`;
      const webhookBody = {
        orderId,
        externalDeliveryId,
        eventType: 'DELIVERED',
        courierName: 'Stuart Courier',
      };
      const parsed = await branchScope
        .get('deliveryProvider')
        .parseWebhook({}, JSON.stringify(webhookBody));
      expect(parsed?.mappedOrderStatus).toBe('COMPLETED');

      const finalTr = await branchBus.dispatch<{
        ok: boolean;
      }>('TransitionOrderStatus', {
        orderId,
        toStatus: 'COMPLETED',
        reason: 'Courier stuart: DELIVERED',
        deliveryProviderCode: 'stuart',
        externalDeliveryId,
        providerPayloadSnapshot: webhookBody,
      });
      expect(finalTr.ok).toBe(true);

      const statusRow = await pgPool.query<{
        status: string;
        deliveryProviderCode: string | null;
      }>(`SELECT "status", "deliveryProviderCode" FROM "Order" WHERE "id" = $1`, [
        orderId,
      ]);
      expect(statusRow.rows[0]?.status).toBe('COMPLETED');
      expect(statusRow.rows[0]?.deliveryProviderCode).toBe('stuart');
    } finally {
      await customerScope.dispose();
      await branchScope.dispose();
    }
  });
});
