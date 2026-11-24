import {
  MerchantSettlementTable,
  type Pool,
  ProcessedEventTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import type { BillingSettlementService } from '@/billing/application/commands';
import type { PaymentChannelMode } from '@/billing/domain/billing-events';
import type { EventBus } from '@/core/application/event-bus';
import { formatGbp, money, roundGbp } from '@/core/domain/money';
import { AppLogger } from '@/logger';

export class BillingSettlementEventHandler {
  private readonly log = new AppLogger('billing-events');
  private readonly pool: Pool;
  private readonly billingService: BillingSettlementService;

  constructor(pool: Pool, billingService: BillingSettlementService) {
    this.pool = pool;
    this.billingService = billingService;
  }

  private async claimEventOnce(eventId: string): Promise<boolean> {
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

    const res = await this.pool.query<typeof ins._result>(ins.text, ins.params);
    return (res.rowCount ?? 0) === 1;
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('OrderSettlementFinancialsRequested', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;

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
      });
      if (!res.ok) {
        throw new Error(`${res.error.code}: ${res.error.message}`);
      }
      this.log.info`Recorded double-entry financials for order ${p.orderId}`;
    });

    eventBus.subscribe('MerchantLoyaltyOffsetApplied', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;

      const p = event.payload as {
        readonly settlementId: string;
        readonly restaurantId: string;
        readonly offsetGbp: string;
        readonly markPaidReference?: string;
      };

      const mCols = MerchantSettlementTable.cols;
      const sel = sqlSelect(MerchantSettlementTable)
        .select([
          mCols.id,
          mCols.grossOnlinePayableGbp,
          mCols.cashCommissionReceivableGbp,
        ])
        .whereEq(mCols.id, p.settlementId)
        .activeOnly()
        .compile();
      const row = (await this.pool.query<typeof sel._result>(sel.text, sel.params)).rows[0];
      if (!row) return;

      const offset = roundGbp(p.offsetGbp);
      const nextPayout = roundGbp(
        money(row.grossOnlinePayableGbp).minus(money(row.cashCommissionReceivableGbp)).plus(offset),
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
      await this.pool.query(upd.text, upd.params);
      this.log.info`Applied £${formatGbp(offset)} loyalty offset to settlement ${p.settlementId}`;
    });
  }
}
