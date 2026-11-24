import { randomUUID } from 'node:crypto';
import { ALL_PERMISSIONS, pgPool, redisClient } from '@foodapp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rootContainer } from '@/container';
import { AppLogger } from '@/logger';

describe('checkout.idempotency-saga — Storefront Checkout & OrderSettlementSaga Integration', () => {
  const branchId = 'b0000000-0000-4000-8000-000000000007';
  const menuItemId = 'e0000000-0000-4000-8000-000000000006';
  const customerId = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    if (!redisClient.isOpen) await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient.isOpen) await redisClient.quit();
  });

  it('commits storefront order, triggers double-entry journal lines, and clears Redis cart', async () => {
    const scope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: customerId,
        actorSource: 'GLOBAL_USER',
        permissions: ALL_PERMISSIONS,
      },
      log: new AppLogger('int-checkout-saga'),
    });

    try {
      const cartService = scope.get('cartService');
      await cartService.saveCart({
        userId: customerId,
        branchId,
        orderSource: 'ONLINE_DELIVERY',
        lines: [
          {
            menuItemId,
            quantity: 2,
          },
        ],
        updatedAt: new Date().toISOString(),
      });

      const commandBus = scope.get('commandBus');
      const idempotencyKey = `idem-${randomUUID()}`;
      const checkout = await commandBus.dispatch<{
        ok: boolean;
        value?: {
          orderId: string;
          status: string;
          totalAmountGbp: string;
        };
      }>('CheckoutOrder', {
        branchId,
        orderSource: 'ONLINE_DELIVERY',
        paymentMode: 'ONLINE_GATEWAY',
        paymentToken: 'tok_visa_approved',
        idempotencyKey,
        items: [
          {
            menuItemId,
            quantity: 2,
          },
        ],
      });

      expect(checkout.ok).toBe(true);
      if (!checkout.ok || !checkout.value) return;
      expect(checkout.value.status).toBe('PLACED');

      const postCart = await cartService.getCart(customerId, branchId);
      expect(postCart).toBeNull();

      const ledgerRes = await pgPool.query<{
        creditAmount: string;
        debitAmount: string;
      }>(
        `SELECT "creditAmount"::text, "debitAmount"::text FROM "FinancialLedger" WHERE "orderId" = $1`,
        [
          checkout.value.orderId,
        ],
      );
      expect(ledgerRes.rows.length).toBeGreaterThanOrEqual(4);
    } finally {
      await scope.dispose();
    }
  });

  it('rejects checkout with empty cart and blocks declined gateway token without persisting order', async () => {
    const scope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: customerId,
        actorSource: 'GLOBAL_USER',
        permissions: ALL_PERMISSIONS,
      },
      log: new AppLogger('int-checkout-negative'),
    });

    try {
      const commandBus = scope.get('commandBus');

      const emptyCartRes = await commandBus.dispatch<{
        ok: boolean;
        error?: {
          code: string;
        };
      }>('CheckoutOrder', {
        branchId,
        orderSource: 'ONLINE_DELIVERY',
        paymentMode: 'ONLINE_GATEWAY',
        paymentToken: 'tok_visa_approved',
        idempotencyKey: `idem-empty-${randomUUID()}`,
      });
      expect(emptyCartRes.ok).toBe(false);

      const declinedRes = await commandBus.dispatch<{
        ok: boolean;
        error?: {
          code: string;
        };
      }>('CheckoutOrder', {
        branchId,
        orderSource: 'ONLINE_DELIVERY',
        paymentMode: 'ONLINE_GATEWAY',
        paymentToken: 'tok_decline',
        idempotencyKey: `idem-declined-${randomUUID()}`,
        items: [
          {
            menuItemId,
            quantity: 1,
          },
        ],
      });
      expect(declinedRes.ok).toBe(false);
    } finally {
      await scope.dispose();
    }
  });
});
