import * as crypto from 'node:crypto';
import { type Pool, ProcessedEventTable, sqlInsert } from '@foodapp/db';
import Decimal from 'decimal.js';
import type { EventBus } from '@/core/application/event-bus';
import { formatGbp } from '@/core/domain/money';
import { AppLogger } from '@/logger';
import type { LoyaltySettlementPort } from '@/loyalty/application/loyalty-ports';
import type {
  LoyaltyHoldConfirmedPayload,
  LoyaltyHoldFailedPayload,
  LoyaltyIssuerScope,
  MerchantLoyaltyOffsetAppliedPayload,
} from '@/loyalty/domain/loyalty-events';

export class LoyaltySettlementEventHandler {
  private readonly log = new AppLogger('loyalty-events');
  private readonly pool: Pool;
  private readonly loyaltyPort: LoyaltySettlementPort;
  private readonly eventBus: EventBus;

  constructor(pool: Pool, loyaltyPort: LoyaltySettlementPort, eventBus: EventBus) {
    this.pool = pool;
    this.loyaltyPort = loyaltyPort;
    this.eventBus = eventBus;
  }

  private async claimEventOnce(eventId: string): Promise<boolean> {
    const pCols = ProcessedEventTable.cols;
    const ins = sqlInsert(ProcessedEventTable)
      .values({
        eventId,
        consumerName: 'LoyaltySettlementEventHandler',
      })
      .onConflictDoNothing([
        pCols.eventId,
      ])
      .returning([
        pCols.eventId,
      ])
      .compile();

    const res = await this.pool.query<typeof ins._result>(ins.text, ins.params);
    return (res.rowCount ?? 0) === 1;
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('LoyaltyHoldRequested', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;

      const p = event.payload as {
        readonly orderId: string;
        readonly userId: string;
        readonly restaurantId: string;
        readonly issuerScope: LoyaltyIssuerScope;
        readonly pointsToHold: number;
        readonly allowLoyaltyRedeem: boolean;
      };

      const holdRes = await this.loyaltyPort.holdCheckoutPoints(
        {
          userId: p.userId,
          restaurantId: p.restaurantId,
          orderId: p.orderId,
          issuerScope: p.issuerScope,
          pointsToHold: p.pointsToHold,
          allowLoyaltyRedeem: p.allowLoyaltyRedeem,
        },
        event.metadata.actorId,
      );

      if (!holdRes.ok) {
        await this.eventBus.publish([
          {
            eventId: crypto.randomUUID(),
            aggregateId: p.orderId,
            aggregateType: 'LoyaltyWalletAggregate',
            eventType: 'LoyaltyHoldFailed',
            version: 1,
            occurredAt: new Date(),
            payload: {
              orderId: p.orderId,
              userId: p.userId,
              code: holdRes.error.code,
              reason: holdRes.error.message,
            } satisfies LoyaltyHoldFailedPayload,
            metadata: event.metadata,
          },
        ]);
        return;
      }

      await this.eventBus.publish([
        {
          eventId: crypto.randomUUID(),
          aggregateId: p.orderId,
          aggregateType: 'LoyaltyWalletAggregate',
          eventType: 'LoyaltyHoldConfirmed',
          version: 1,
          occurredAt: new Date(),
          payload: {
            orderId: p.orderId,
            userId: p.userId,
            pointsHeld: holdRes.value.pointsHeld,
            discountGbp: formatGbp(holdRes.value.discountGbp),
            issuerScope: holdRes.value.issuerScope,
          } satisfies LoyaltyHoldConfirmedPayload,
          metadata: event.metadata,
        },
      ]);
      this.log.info`Held ${holdRes.value.pointsHeld} loyalty points for order ${p.orderId}`;
    });

    eventBus.subscribe('BillingSettlementRecorded', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;

      const p = event.payload as {
        readonly orderId: string;
        readonly restaurantId: string;
        readonly customerId?: string;
        readonly subtotalGbp: string;
        readonly allowLoyaltyEarn?: boolean;
      };
      if (!p.customerId) return;

      await this.loyaltyPort.settleOrderLoyalty({
        orderId: p.orderId,
        userId: p.customerId,
        restaurantId: p.restaurantId,
        netFoodSubtotalGbp: new Decimal(p.subtotalGbp),
        allowLoyaltyEarn: p.allowLoyaltyEarn ?? true,
        actorId: event.metadata.actorId,
      });
      this.log.info`Settled loyalty hold & pending accrual for order ${p.orderId}`;
    });

    eventBus.subscribe('OrderCancelledOrRejected', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;

      const p = event.payload as {
        readonly orderId: string;
        readonly customerId?: string;
        readonly reason: string;
      };
      if (!p.customerId) return;

      await this.loyaltyPort.releaseCheckoutHold(
        p.orderId,
        p.customerId,
        p.reason,
        event.metadata.actorId,
      );
      this.log.info`Released held loyalty points for cancelled order ${p.orderId}`;
    });

    eventBus.subscribe('MerchantLoyaltyOffsetRequested', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;

      const p = event.payload as {
        readonly settlementId: string;
        readonly restaurantId: string;
        readonly maxOffsetGbp: string;
        readonly markPaidReference?: string;
      };

      const offsetRes = await this.loyaltyPort.redeemMerchantPointsForFeeOffset({
        restaurantId: p.restaurantId,
        settlementId: p.settlementId,
        maxOffsetGbp: new Decimal(p.maxOffsetGbp),
        actorId: event.metadata.actorId,
      });

      await this.eventBus.publish([
        {
          eventId: crypto.randomUUID(),
          aggregateId: p.settlementId,
          aggregateType: 'LoyaltyWalletAggregate',
          eventType: 'MerchantLoyaltyOffsetApplied',
          version: 1,
          occurredAt: new Date(),
          payload: {
            settlementId: p.settlementId,
            restaurantId: p.restaurantId,
            pointsRedeemed: offsetRes.pointsRedeemed,
            offsetGbp: formatGbp(offsetRes.offsetGbp),
            markPaidReference: p.markPaidReference,
          } satisfies MerchantLoyaltyOffsetAppliedPayload,
          metadata: event.metadata,
        },
      ]);
      this.log
        .info`Redeemed ${offsetRes.pointsRedeemed} merchant points for settlement ${p.settlementId}`;
    });
  }
}
