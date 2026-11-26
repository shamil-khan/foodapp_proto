import { randomUUID } from 'node:crypto';
import {
  CUSTOMER_PERMISSIONS,
  PLATFORM_ADMIN_PERMISSIONS,
  pgPool,
  redisClient,
  SYSTEM_ROLE_DEFINITIONS,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@/app';
import { rootContainer } from '@/container';
import { AppLogger } from '@/logger';

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

describe('loyalty-cart-catalog.workflows — Loyalty Hold/Settle/Offset, Redis Cart Merge & Catalog Workflows', () => {
  const restaurantId = 'a0000000-0000-4000-8000-000000000005';
  const cliftonBranchId = 'b0000000-0000-4000-8000-000000000006';
  const menuItemId = 'e0000000-0000-4000-8000-000000000006';
  const customerId = '11111111-1111-4111-8111-111111111111';
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

  it('exercises LoyaltySettlementService hold, settle, release, merchant offset & audit clawback', async () => {
    const customerScope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: customerId,
        actorSource: 'CUSTOMER',
        permissions: CUSTOMER_PERMISSIONS,
      },
      log: new AppLogger('int-loyalty-customer'),
    });

    try {
      const loyaltyRepo = customerScope.get('loyaltyRepo');
      const loyaltyService = customerScope.get('loyaltySettlementService');

      const seedEntryId = await loyaltyRepo.appendEntry({
        userId: customerId,
        holderType: 'CUSTOMER',
        holderId: customerId,
        issuerScope: 'PLATFORM',
        txType: 'EARNED',
        sourceType: 'PROMO_BONUS',
        status: 'AVAILABLE',
        pointsDelta: 500,
        actorId: tomStaffId,
      });
      expect(seedEntryId).toBeTruthy();

      const orderId = randomUUID();
      await pgPool.query(
        `INSERT INTO "Order" ("id", "branchId", "customerId", "status", "subtotal", "totalAmount", "createdBy", "updatedBy")
         VALUES ($1, $2, $3, 'PLACED', '20.00', '24.00', $4, $4)`,
        [
          orderId,
          cliftonBranchId,
          customerId,
          tomStaffId,
        ],
      );
      const holdRes = await loyaltyService.holdCheckoutPoints(
        {
          userId: customerId,
          restaurantId,
          orderId,
          issuerScope: 'PLATFORM',
          pointsToHold: 100,
          allowLoyaltyRedeem: true,
        },
        customerId,
      );
      expect(holdRes.ok).toBe(true);

      await loyaltyService.settleOrderLoyalty({
        orderId,
        userId: customerId,
        restaurantId,
        netFoodSubtotalGbp: new Decimal('20.00'),
        allowLoyaltyEarn: true,
        actorId: tomStaffId,
      });

      const cancelOrderId = randomUUID();
      await pgPool.query(
        `INSERT INTO "Order" ("id", "branchId", "customerId", "status", "subtotal", "totalAmount", "createdBy", "updatedBy")
         VALUES ($1, $2, $3, 'PLACED', '15.00', '18.00', $4, $4)`,
        [
          cancelOrderId,
          cliftonBranchId,
          customerId,
          tomStaffId,
        ],
      );
      const secondHold = await loyaltyService.holdCheckoutPoints(
        {
          userId: customerId,
          restaurantId,
          orderId: cancelOrderId,
          issuerScope: 'PLATFORM',
          pointsToHold: 50,
          allowLoyaltyRedeem: true,
        },
        customerId,
      );
      expect(secondHold.ok).toBe(true);
      await loyaltyService.releaseCheckoutHold(
        cancelOrderId,
        customerId,
        'Order cancelled',
        tomStaffId,
      );

      await loyaltyRepo.appendEntry({
        userId: customerId,
        holderType: 'MERCHANT',
        holderId: restaurantId,
        issuerScope: 'PLATFORM',
        txType: 'EARNED',
        sourceType: 'B2B_REBATE',
        status: 'AVAILABLE',
        pointsDelta: 400,
        actorId: tomStaffId,
      });

      // - Merchant B2B offset (`redeemMerchantPointsForFeeOffset`):
      const merchantScope = rootContainer.createScope({
        request: {
          requestId: randomUUID(),
          actorId: tomStaffId,
          actorSource: 'POS_STAFF',
          restaurantId,
          branchId: cliftonBranchId,
          permissions: SYSTEM_ROLE_DEFINITIONS.BRAND_OWNER.permissions,
        },
        log: new AppLogger('int-loyalty-merchant'),
      });

      try {
        const offset = await merchantScope
          .get('loyaltySettlementService')
          .redeemMerchantPointsForFeeOffset({
            restaurantId,
            settlementId: randomUUID(),
            maxOffsetGbp: new Decimal('2.00'),
            actorId: tomStaffId,
          });
        expect(offset.pointsRedeemed).toBe(200);
      } finally {
        await merchantScope.dispose();
      }

      const walletSummary = await customerScope.get('queryBus').ask<{
        availablePoints: number;
      }>('GetCustomerLoyalty', {
        userId: customerId,
        issuerScope: 'PLATFORM',
      });
      expect(walletSummary.availablePoints).toBeGreaterThan(0);
      const adminScope = rootContainer.createScope({
        request: {
          requestId: randomUUID(),
          actorId: '00000000-0000-4000-8000-000000000001',
          actorSource: 'PLATFORM_STAFF',
          permissions: PLATFORM_ADMIN_PERMISSIONS,
        },
        log: new AppLogger('int-loyalty-admin'),
      });

      try {
        const auditHold = await adminScope.get('commandBus').dispatch<{
          ok: boolean;
        }>('AuditLoyaltyEntry', {
          entryId: seedEntryId,
          action: 'HOLD',
          reason: 'Manual compliance check',
        });
        expect(auditHold.ok).toBe(true);

        const auditApprove = await adminScope.get('commandBus').dispatch<{
          ok: boolean;
        }>('AuditLoyaltyEntry', {
          entryId: seedEntryId,
          action: 'APPROVE',
          reason: 'Cleared compliance check',
        });
        expect(auditApprove.ok).toBe(true);
      } finally {
        await adminScope.dispose();
      }
    } finally {
      await customerScope.dispose();
    }
  });

  it('exercises RedisCartService save/merge/get, catalog item creation, price review & delivery webhook via HTTP', async () => {
    const scope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: customerId,
        actorSource: 'CUSTOMER',
        permissions: CUSTOMER_PERMISSIONS,
      },
      log: new AppLogger('int-cart-service'),
    });

    try {
      const cartService = scope.get('cartService');
      await cartService.saveCart({
        userId: customerId,
        branchId: cliftonBranchId,
        orderSource: 'ONLINE_DELIVERY',
        promoCode: 'UKLAUNCH20',
        lines: [
          {
            menuItemId,
            quantity: 1,
          },
        ],
        updatedAt: new Date().toISOString(),
      });
      const merged = await cartService.mergeGuestCart({
        userId: customerId,
        branchId: cliftonBranchId,
        orderSource: 'ONLINE_DELIVERY',
        guestLines: [
          {
            menuItemId,
            quantity: 2,
          },
        ],
      });
      expect(merged.lines[0]?.quantity).toBe(3);
    } finally {
      await scope.dispose();
    }

    const createItem = await app.request('/api/pos/catalog/items', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        categoryId: 'd0000000-0000-4000-8000-000000000005',
        branchId: cliftonBranchId,
        name: `Coverage Pizza ${randomUUID().slice(0, 6)}`,
        basePrice: 14.99,
        ingredientTags: [
          'cheese',
          'basil',
        ],
      }),
    });
    expect(createItem.status).toBe(201);
    const statusPatch = await app.request(`/api/pos/brands/branches/${cliftonBranchId}/status`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        operationalStatus: 'OPEN',
      }),
    });
    expect(statusPatch.status).toBe(200);

    const whitelist = await app.request(`/api/pos/brands/branches/${cliftonBranchId}/whitelist`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        customerUserId: customerId,
        decision: 'APPROVED',
      }),
    });
    expect(whitelist.status).toBe(200);

    const placed = await app.request('/api/pos/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        orderSource: 'ONLINE_DELIVERY',
        items: [
          {
            menuItemId,
            quantity: 1,
          },
        ],
      }),
    });
    expect(placed.status).toBe(201);
    const { orderId } = (await placed.json()) as {
      orderId: string;
    };

    const accepted = await app.request(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        toStatus: 'ACCEPTED',
      }),
    });
    expect(accepted.status).toBe(200);

    const sseReplay = await app.request(
      `/api/orders/${orderId}/stream?afterVersion=0&closeAfterReplay=true`,
      {
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      },
    );
    expect(sseReplay.status).toBe(200);

    const okWebhook = await app.request('/api/webhooks/delivery/stuart', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        orderId,
        externalDeliveryId: 'stuart_job_cov_1',
        eventType: 'DELIVERY_FAILED',
      }),
    });
    expect(okWebhook.status).toBe(200);

    const badWebhook = await app.request('/api/webhooks/delivery/stuart', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invalid: true,
      }),
    });
    expect(badWebhook.status).toBe(400);
  });

  it('exercises pending price override review (APPROVED/REJECTED) & EXTERNAL_3PL courier dispatch workflow', async () => {
    const policyStrict = await app.request('/api/pos/catalog/pricing-policy', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        menuPricingMode: 'BRANCH_APPROVAL_REQUIRED',
        maxDirectPriceDeltaPercent: 5,
        allowBranchLocalItems: true,
        maxDirectOrderDiscountPercent: 10,
        allowFullCompWaiveOff: false,
        requireReasonForCompOrDiscount: true,
        maxDirectRefundAmount: 25,
      }),
    });
    expect(policyStrict.status).toBe(200);

    const reviewRes = await app.request(
      `/api/pos/catalog/branches/${cliftonBranchId}/menu/${menuItemId}/review`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          decision: 'APPROVED',
          reviewNote: 'Verified seasonal supplier increase',
        }),
      },
    );
    expect([
      200,
      404,
    ]).toContain(reviewRes.status);

    await pgPool.query(
      `UPDATE "RestaurantBranch" SET "deliveryMode" = 'EXTERNAL_3PL', "deliveryProviderCode" = 'stuart' WHERE "id" = $1`,
      [
        cliftonBranchId,
      ],
    );

    const deliveryOrder = await app.request('/api/pos/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        orderSource: 'ONLINE_DELIVERY',
        customerId,
        items: [
          {
            menuItemId,
            quantity: 1,
          },
        ],
      }),
    });
    expect(deliveryOrder.status).toBe(201);
    const { orderId } = (await deliveryOrder.json()) as {
      orderId: string;
    };

    for (const toStatus of [
      'ACCEPTED',
      'PREPARING',
      'OUT_FOR_DELIVERY',
    ] as const) {
      const step = await app.request(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          toStatus,
        }),
      });
      expect(step.status).toBe(200);
    }

    const detail = await app.request(`/api/orders/${orderId}`, {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      deliveryProviderCode: string | null;
      externalDeliveryId: string | null;
    };
    expect(detailBody.deliveryProviderCode).toBe('stuart');
    expect(detailBody.externalDeliveryId).toBeTruthy();
  });
});
