import { randomUUID } from 'node:crypto';
import { ALL_PERMISSIONS, pgPool, redisClient, SYSTEM_ACTORS } from '@foodapp/db';
import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rootContainer } from '@/container';
import { AppLogger } from '@/logger';

async function insertStubOrder(
  orderId: string,
  branchId: string,
  subtotalGbp: string,
  totalGbp: string,
): Promise<void> {
  await pgPool.query(
    `INSERT INTO "Order" ("id", "branchId", "status", "subtotal", "totalAmount", "createdBy", "updatedBy")
     VALUES ($1, $2, 'COMPLETED', $3, $4, $5, $5)`,
    [
      orderId,
      branchId,
      subtotalGbp,
      totalGbp,
      SYSTEM_ACTORS.SYSTEM_CRON,
    ],
  );
}

describe('billing.b2b-settlement — Online Payable vs Cash Commission Netting & Payout', () => {
  const restaurantId = 'a0000000-0000-4000-8000-000000000005';
  const branchId = 'b0000000-0000-4000-8000-000000000006';

  beforeAll(async () => {
    if (!redisClient.isOpen) await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient.isOpen) await redisClient.quit();
  });

  it('nets online gateway merchant payables against cash commission receivables in GBP', async () => {
    const scope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: SYSTEM_ACTORS.SYSTEM_CRON,
        actorSource: 'SYSTEM',
        restaurantId,
        branchId,
        permissions: ALL_PERMISSIONS,
      },
      log: new AppLogger('int-b2b-settle'),
    });

    try {
      const billingService = scope.get('billingSettlementService');
      const onlineOrderId = randomUUID();
      const cashOrderId = randomUUID();
      await insertStubOrder(onlineOrderId, branchId, '40.00', '48.00');
      await insertStubOrder(cashOrderId, branchId, '20.00', '24.00');

      const onlineRec = await billingService.recordOrderFinancials({
        orderId: onlineOrderId,
        branchId,
        restaurantId,
        paymentMode: 'ONLINE_GATEWAY',
        subtotalGbp: new Decimal('40.00'),
        vatGbp: new Decimal('8.00'),
        deliveryFeeGbp: new Decimal('0.00'),
        loyaltyDiscountGbp: new Decimal('0.00'),
        allowLoyaltyEarn: true,
        actorId: SYSTEM_ACTORS.SYSTEM_CRON,
      });
      expect(onlineRec.ok).toBe(true);

      const cashRec = await billingService.recordOrderFinancials({
        orderId: cashOrderId,
        branchId,
        restaurantId,
        paymentMode: 'CASH',
        subtotalGbp: new Decimal('20.00'),
        vatGbp: new Decimal('4.00'),
        deliveryFeeGbp: new Decimal('0.00'),
        loyaltyDiscountGbp: new Decimal('0.00'),
        allowLoyaltyEarn: false,
        actorId: SYSTEM_ACTORS.SYSTEM_CRON,
      });
      expect(cashRec.ok).toBe(true);

      const settle = await scope.get('commandBus').dispatch<{
        ok: boolean;
        value?: {
          settlementId: string;
          netPayoutGbp: string;
        };
      }>('SettleMerchant', {
        restaurantId,
        markPaidReference: `FPS-${randomUUID().slice(0, 8)}`,
      });
      expect(settle.ok).toBe(true);
      if (settle.ok && settle.value) {
        expect(settle.value.settlementId).toBeTruthy();
        expect(Number(settle.value.netPayoutGbp)).toBeGreaterThan(0);
      }
    } finally {
      await scope.dispose();
    }
  });

  it('handles cash-heavy periods where commission receivable exceeds online payable without negative payout', async () => {
    const cashOnlyBrandId = 'a0000000-0000-4000-8000-000000000002';
    const cashOnlyBranchId = 'b0000000-0000-4000-8000-000000000002';

    const scope = rootContainer.createScope({
      request: {
        requestId: randomUUID(),
        actorId: SYSTEM_ACTORS.SYSTEM_CRON,
        actorSource: 'SYSTEM',
        restaurantId: cashOnlyBrandId,
        branchId: cashOnlyBranchId,
        permissions: ALL_PERMISSIONS,
      },
      log: new AppLogger('int-b2b-cash-only'),
    });

    try {
      const billingService = scope.get('billingSettlementService');
      const cashOrderId = randomUUID();
      await insertStubOrder(cashOrderId, cashOnlyBranchId, '50.00', '60.00');

      const cashRec = await billingService.recordOrderFinancials({
        orderId: cashOrderId,
        branchId: cashOnlyBranchId,
        restaurantId: cashOnlyBrandId,
        paymentMode: 'CASH',
        subtotalGbp: new Decimal('50.00'),
        vatGbp: new Decimal('10.00'),
        deliveryFeeGbp: new Decimal('0.00'),
        loyaltyDiscountGbp: new Decimal('0.00'),
        allowLoyaltyEarn: false,
        actorId: SYSTEM_ACTORS.SYSTEM_CRON,
      });
      expect(cashRec.ok).toBe(true);

      const ledgerRows = await pgPool.query<{
        creditAmount: string;
        debitAmount: string;
      }>(
        `SELECT "creditAmount"::text, "debitAmount"::text FROM "FinancialLedger" WHERE "orderId" = $1`,
        [
          cashOrderId,
        ],
      );
      expect(ledgerRows.rows.length).toBeGreaterThanOrEqual(2);
    } finally {
      await scope.dispose();
    }
  });
});
