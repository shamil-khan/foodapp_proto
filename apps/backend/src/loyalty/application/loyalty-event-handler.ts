import * as crypto from 'node:crypto';
import { type DbExecutor, ProcessedEventTable, sqlInsert, type UnitOfWork } from '@foodapp/db';
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
  private readonly uow: UnitOfWork;
  private readonly loyaltyPort: LoyaltySettlementPort;
  private readonly eventBus: EventBus;

  constructor(uow: UnitOfWork, loyaltyPort: LoyaltySettlementPort, eventBus: EventBus) {
    this.uow = uow;
    this.loyaltyPort = loyaltyPort;
    this.eventBus = eventBus;
  }

  private async claimEventOnce(eventId: string, tx: DbExecutor): Promise<boolean> {
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

    const row = await tx.queryOne(ins);
    return Boolean(row);
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('LoyaltyHoldRequested', async (event) => {
      const p = event.payload as {
        readonly orderId: string;
        readonly userId: string;
        readonly restaurantId: string;
        readonly issuerScope: LoyaltyIssuerScope;
        readonly pointsToHold: number;
        readonly allowLoyaltyRedeem: boolean;
      };

      const outcome = await this.uow.transaction(async (tx) => {
        if (!(await this.claimEventOnce(event.eventId, tx))) return null;
        return await this.loyaltyPort.holdCheckoutPoints(
          {
            userId: p.userId,
            restaurantId: p.restaurantId,
            orderId: p.orderId,
            issuerScope: p.issuerScope,
            pointsToHold: p.pointsToHold,
            allowLoyaltyRedeem: p.allowLoyaltyRedeem,
          },
          event.metadata.actorId,
          tx,
        );
      });
      if (!outcome) return;

      if (!outcome.ok) {
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
              code: outcome.error.code,
              reason: outcome.error.message,
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
            pointsHeld: outcome.value.pointsHeld,
            discountGbp: formatGbp(outcome.value.discountGbp),
            issuerScope: outcome.value.issuerScope,
          } satisfies LoyaltyHoldConfirmedPayload,
          metadata: event.metadata,
        },
      ]);
      this.log.info`Held ${outcome.value.pointsHeld} loyalty points for order ${p.orderId}`;
    });

    eventBus.subscribe('BillingSettlementRecorded', async (event) => {
      const p = event.payload as {
        readonly orderId: string;
        readonly restaurantId: string;
        readonly customerId?: string;
        readonly subtotalGbp: string;
        readonly allowLoyaltyEarn?: boolean;
      };

      const committed = await this.uow.transaction(async (tx) => {
        if (!(await this.claimEventOnce(event.eventId, tx))) return false;
        if (!p.customerId) return true;
        await this.loyaltyPort.settleOrderLoyalty({
          orderId: p.orderId,
          userId: p.customerId,
          restaurantId: p.restaurantId,
          netFoodSubtotalGbp: new Decimal(p.subtotalGbp),
          allowLoyaltyEarn: p.allowLoyaltyEarn ?? true,
          actorId: event.metadata.actorId,
          tx,
        });
        return true;
      });
      if (committed && p.customerId) {
        this.log.info`Settled loyalty hold & pending accrual for order ${p.orderId}`;
      }
    });

    eventBus.subscribe('OrderCancelledOrRejected', async (event) => {
      const p = event.payload as {
        readonly orderId: string;
        readonly customerId?: string;
        readonly reason: string;
      };

      const committed = await this.uow.transaction(async (tx) => {
        if (!(await this.claimEventOnce(event.eventId, tx))) return false;
        if (!p.customerId) return true;
        await this.loyaltyPort.releaseCheckoutHold(
          p.orderId,
          p.customerId,
          p.reason,
          event.metadata.actorId,
          tx,
        );
        return true;
      });
      if (committed && p.customerId) {
        this.log.info`Released held loyalty points for cancelled order ${p.orderId}`;
      }
    });

    eventBus.subscribe('MerchantLoyaltyOffsetRequested', async (event) => {
      const p = event.payload as {
        readonly settlementId: string;
        readonly restaurantId: string;
        readonly maxOffsetGbp: string;
        readonly markPaidReference?: string;
      };

      const offsetRes = await this.uow.transaction(async (tx) => {
        if (!(await this.claimEventOnce(event.eventId, tx))) return null;
        return await this.loyaltyPort.redeemMerchantPointsForFeeOffset({
          restaurantId: p.restaurantId,
          settlementId: p.settlementId,
          maxOffsetGbp: new Decimal(p.maxOffsetGbp),
          actorId: event.metadata.actorId,
          tx,
        });
      });
      if (!offsetRes) return;

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
