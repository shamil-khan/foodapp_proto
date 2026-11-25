import {
  type DbExecutor,
  MerchantSettlementTable,
  ProcessedEventTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
  type UnitOfWork,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import type { BillingSettlementService } from '@/billing/application/commands';
import type { PaymentChannelMode } from '@/billing/domain/billing-events';
import type { EventBus } from '@/core/application/event-bus';
import { formatGbp, money, roundGbp } from '@/core/domain/money';
import { AppLogger } from '@/logger';

export class BillingSettlementEventHandler {
  private readonly log = new AppLogger('billing-events');
  private readonly uow: UnitOfWork;
  private readonly billingService: BillingSettlementService;

  constructor(uow: UnitOfWork, billingService: BillingSettlementService) {
    this.uow = uow;
    this.billingService = billingService;
  }

  // 2. Update `claimEventOnce` to execute on `tx`:
  private async claimEventOnce(eventId: string, tx: DbExecutor): Promise<boolean> {
    const pCols = ProcessedEventTable.cols;
    const ins = sqlInsert(ProcessedEventTable)
      .values({
        eventId,
        consumerName: 'BillingSettlementEventHandler',
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

  // 3. In `register(eventBus)`, claim inside `this.uow.transaction`:
  public register(eventBus: EventBus): void {
    eventBus.subscribe('OrderSettlementFinancialsRequested', async (event) => {
      const p = event.payload as {
        readonly orderId: string;
        readonly branchId: string;
        readonly restaurantId: string;
        readonly customerId?: string;
        readonly paymentMode: PaymentChannelMode;
        readonly gatewayReference?: string;
        readonly subtotalGbp: string;
        readonly vatGbp: string;
        readonly deliveryFeeGbp: string;
        readonly loyaltyDiscountGbp: string;
        readonly allowLoyaltyEarn: boolean;
      };

      const events = await this.uow.transaction(async (tx) => {
        if (!(await this.claimEventOnce(event.eventId, tx))) return null;

        const res = await this.billingService.recordOrderFinancials({
          orderId: p.orderId,
          branchId: p.branchId,
          restaurantId: p.restaurantId,
          customerId: p.customerId,
          paymentMode: p.paymentMode,
          gatewayReference: p.gatewayReference,
          subtotalGbp: new Decimal(p.subtotalGbp),
          vatGbp: new Decimal(p.vatGbp),
          deliveryFeeGbp: new Decimal(p.deliveryFeeGbp),
          loyaltyDiscountGbp: new Decimal(p.loyaltyDiscountGbp),
          allowLoyaltyEarn: p.allowLoyaltyEarn,
          actorId: event.metadata.actorId,
          tx,
          deferPublish: true,
        });
        if (!res.ok) {
          throw new Error(`${res.error.code}: ${res.error.message}`);
        }
        return res.value;
      });

      if (events) {
        await eventBus.publish(events);
        this.log.info`Recorded double-entry financials for order ${p.orderId}`;
      }
    });

    eventBus.subscribe('MerchantLoyaltyOffsetApplied', async (event) => {
      const p = event.payload as {
        readonly settlementId: string;
        readonly restaurantId: string;
        readonly offsetGbp: string;
        readonly markPaidReference?: string;
      };

      const mCols = MerchantSettlementTable.cols;
      await this.uow.transaction(async (tx) => {
        if (!(await this.claimEventOnce(event.eventId, tx))) return;

        const sel = sqlSelect(MerchantSettlementTable)
          .select([
            mCols.id,
            mCols.grossOnlinePayableGbp,
            mCols.cashCommissionReceivableGbp,
          ])
          .whereEq(mCols.id, p.settlementId)
          .activeOnly()
          .compile();
        const row = await tx.queryOne(sel);
        if (!row) return;

        const offset = roundGbp(p.offsetGbp);
        const nextPayout = roundGbp(
          money(row.grossOnlinePayableGbp)
            .minus(money(row.cashCommissionReceivableGbp))
            .plus(offset),
        );
        const upd = sqlUpdate(MerchantSettlementTable)
          .set({
            loyaltyFeeOffsetGbp: formatGbp(offset),
            netPayoutGbp: formatGbp(nextPayout),
            status: p.markPaidReference ? 'PAID' : 'PENDING_PAYOUT',
            payoutReference: p.markPaidReference ?? undefined,
            paidAt: p.markPaidReference ? new Date() : undefined,
          })
          .withAuditBump(event.metadata.actorId)
          .whereEq(mCols.id, p.settlementId)
          .compile();
        await tx.execute(upd);
        this.log.info`Applied £${formatGbp(offset)} loyalty offset to settlement ${p.settlementId}`;
      });
    });
  }
}
