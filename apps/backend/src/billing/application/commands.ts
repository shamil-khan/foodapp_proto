import * as crypto from 'node:crypto';
import {
  MerchantSettlementTable,
  OrderTable,
  type Pool,
  RestaurantTable,
  sqlSelect,
  sqlUpdate,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import type { PaymentGatewayPort } from '@/billing/application/payment-gateway-port';
import { FinancialLedgerAggregate } from '@/billing/domain/billing-aggregate';
import type {
  BillingSettlementRecordedPayload,
  MerchantLoyaltyOffsetRequestedPayload,
  PaymentChannelMode,
} from '@/billing/domain/billing-events';
import { UkStandardVatStrategy } from '@/billing/domain/vat-strategy';
import type { BillingRepository } from '@/billing/infrastructure/billing-repository';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import type { EventBus } from '@/core/application/event-bus';
import { formatGbp, money, roundGbp } from '@/core/domain/money';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export class BillingSettlementService {
  private readonly pool: Pool;
  private readonly repo: BillingRepository;
  private readonly eventBus: EventBus;
  private readonly vatStrategy = new UkStandardVatStrategy();

  constructor(pool: Pool, repo: BillingRepository, eventBus: EventBus) {
    this.pool = pool;
    this.repo = repo;
    this.eventBus = eventBus;
  }

  async recordOrderFinancials(params: {
    readonly orderId: string;
    readonly branchId: string;
    readonly restaurantId: string;
    readonly customerId?: string;
    readonly paymentMode: PaymentChannelMode;
    readonly gatewayReference?: string;
    readonly subtotalGbp: Decimal;
    readonly vatGbp: Decimal;
    readonly deliveryFeeGbp: Decimal;
    readonly loyaltyDiscountGbp: Decimal;
    readonly allowLoyaltyEarn: boolean;
    readonly actorId: string;
  }): Promise<Result<void>> {
    const rCols = RestaurantTable.cols;
    const rQ = sqlSelect(RestaurantTable)
      .select([
        rCols.platformFeeRate,
      ])
      .whereEq(rCols.id, params.restaurantId)
      .activeOnly()
      .compile();
    const rRow = (await this.pool.query<typeof rQ._result>(rQ.text, rQ.params)).rows[0];
    const commissionRate = new Decimal(rRow?.platformFeeRate ?? '15.00');
    const commissionNet = roundGbp(params.subtotalGbp.mul(commissionRate).div(100));
    const commissionVat = this.vatStrategy.calculateCommissionVat(commissionNet);

    const state = await this.repo.loadRestaurantLedgerState(params.restaurantId);
    const ledger = FinancialLedgerAggregate.fromSnapshot(params.restaurantId, state);
    const rec = ledger.recordOrderSettlement(
      {
        ...params,
        commissionRatePercent: commissionRate,
        commissionVatGbp: commissionVat,
      },
      {
        actorId: params.actorId,
        restaurantId: params.restaurantId,
      },
    );
    if (!rec.ok) return rec;

    const events = ledger.pullDomainEvents();
    for (const ev of events) {
      if (ev.eventType === 'BillingSettlementRecorded') {
        const p = ev.payload as BillingSettlementRecordedPayload;
        await this.repo.appendJournalLines({
          orderId: p.orderId,
          branchId: p.branchId,
          restaurantId: p.restaurantId,
          lines: p.journalLines,
          actorId: params.actorId,
        });
      }
      await this.eventBus.publish([
        ev,
      ]);
    }
    return ok(undefined);
  }
}

export interface RefundOrderCommand
  extends Command<
    Result<{
      readonly refundReference: string;
    }>
  > {
  readonly orderId: string;
  readonly amountGbp: string;
  readonly reason: string;
}

export class RefundOrderHandler
  implements
    CommandHandler<
      RefundOrderCommand,
      Result<{
        readonly refundReference: string;
      }>
    >
{
  private readonly pool: Pool;
  private readonly repo: BillingRepository;
  private readonly gateway: PaymentGatewayPort;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    pool: Pool,
    repo: BillingRepository,
    gateway: PaymentGatewayPort,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.pool = pool;
    this.repo = repo;
    this.gateway = gateway;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: RefundOrderCommand): Promise<
    Result<{
      readonly refundReference: string;
    }>
  > {
    const oCols = OrderTable.cols;
    const oQ = sqlSelect(OrderTable).whereEq(oCols.id, cmd.orderId).activeOnly().compile();
    const order = (await this.pool.query<typeof oQ._result>(oQ.text, oQ.params)).rows[0];
    if (!order) {
      return err(new DomainError('ORDER_NOT_FOUND', 'Order not found.', 404));
    }

    const access = this.authz.assertBranchAccess(order.branchId, 'orders:settle');
    if (!access.ok) return access;

    const refundAmt = roundGbp(cmd.amountGbp);
    const grossTotal = roundGbp(order.totalAmount);
    if (refundAmt.lte(0) || refundAmt.gt(grossTotal)) {
      return err(new DomainError('INVALID_REFUND', 'Refund amount exceeds order total.', 400));
    }

    const gwRes = await this.gateway.refundCharge({
      providerReference: order.idempotencyKey ?? order.id,
      amountGbp: refundAmt,
      reason: cmd.reason,
    });
    if (gwRes.status === 'FAILED') {
      return err(new DomainError('GATEWAY_REFUND_FAILED', 'Payment gateway rejected refund.', 502));
    }

    const restaurantId = this.request.restaurantId ?? '';
    await this.repo.appendJournalLines({
      orderId: order.id,
      branchId: order.branchId,
      restaurantId,
      lines: [
        {
          accountCode: 'MERCHANT_PAYABLE',
          side: 'DEBIT',
          amountGbp: formatGbp(refundAmt),
          description: `Refund debit for order ${order.id}: ${cmd.reason}`,
        },
        {
          accountCode: 'PLATFORM_GATEWAY_CLEARING',
          side: 'CREDIT',
          amountGbp: formatGbp(refundAmt),
          description: `Gateway refund credit (${gwRes.refundReference})`,
        },
      ],
      actorId: this.request.actorId,
    });

    return ok({
      refundReference: gwRes.refundReference,
    });
  }
}

export interface SettleMerchantCommand
  extends Command<
    Result<{
      readonly settlementId: string;
      readonly netPayoutGbp: string;
    }>
  > {
  readonly restaurantId: string;
  readonly applyLoyaltyOffset?: boolean;
  readonly markPaidReference?: string;
}

export class SettleMerchantHandler
  implements
    CommandHandler<
      SettleMerchantCommand,
      Result<{
        readonly settlementId: string;
        readonly netPayoutGbp: string;
      }>
    >
{
  private readonly pool: Pool;
  private readonly repo: BillingRepository;
  private readonly eventBus: EventBus;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    pool: Pool,
    repo: BillingRepository,
    eventBus: EventBus,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.pool = pool;
    this.repo = repo;
    this.eventBus = eventBus;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: SettleMerchantCommand): Promise<
    Result<{
      readonly settlementId: string;
      readonly netPayoutGbp: string;
    }>
  > {
    // FILE: apps/backend/src/billing/application/commands.ts (SettleMerchantHandler.execute)
    const access = this.authz.assertRestaurantAccess(
      cmd.restaurantId,
      'ledger:read',
      'platform:support:billing-settle',
    );
    if (!access.ok) return access;

    const rCols = RestaurantTable.cols;
    const rQ = sqlSelect(RestaurantTable)
      .select([
        rCols.isActiveOverride,
      ])
      .whereEq(rCols.id, cmd.restaurantId)
      .activeOnly()
      .compile();
    const rest = (await this.pool.query<typeof rQ._result>(rQ.text, rQ.params)).rows[0];
    if (!rest) {
      return err(new DomainError('RESTAURANT_NOT_FOUND', 'Merchant not found.', 404));
    }
    if (!rest.isActiveOverride) {
      return err(
        new DomainError(
          'MERCHANT_FROZEN',
          'Payout blocked: merchant account is suspended/frozen.',
          403,
        ),
      );
    }

    const ledgerState = await this.repo.loadRestaurantLedgerState(cmd.restaurantId);
    const grossOnline = money(ledgerState.merchantPayableGbp);
    const cashReceivable = money(ledgerState.cashCommissionReceivableGbp);
    if (grossOnline.isZero() && cashReceivable.isZero()) {
      return err(new DomainError('NOTHING_TO_SETTLE', 'No unsettled billing entries found.', 409));
    }

    const netPayout = roundGbp(grossOnline.minus(cashReceivable));
    const shouldRequestOffset = Boolean(cmd.applyLoyaltyOffset && cashReceivable.gt(0));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date();
      const settlementId = await this.repo.createMerchantSettlement(
        {
          restaurantId: cmd.restaurantId,
          periodStart: new Date(now.getTime() - 7 * 86_400_000),
          periodEnd: now,
          grossOnlinePayableGbp: formatGbp(grossOnline),
          cashCommissionReceivableGbp: formatGbp(cashReceivable),
          loyaltyFeeOffsetGbp: '0.00',
          commissionVatGbp: '0.00',
          netPayoutGbp: formatGbp(netPayout),
          status: cmd.markPaidReference && !shouldRequestOffset ? 'PAID' : 'PENDING_PAYOUT',
          actorId: this.request.actorId,
        },
        client,
      );

      if (cmd.markPaidReference && !shouldRequestOffset) {
        const mCols = MerchantSettlementTable.cols;
        const markPaid = sqlUpdate(MerchantSettlementTable)
          .set({
            payoutReference: cmd.markPaidReference,
            paidAt: now,
          })
          .withAuditBump(this.request.actorId)
          .whereEq(mCols.id, settlementId)
          .compile();
        await client.query(markPaid.text, markPaid.params);
      }

      await client.query('COMMIT');

      if (shouldRequestOffset) {
        await this.eventBus.publish([
          {
            eventId: crypto.randomUUID(),
            aggregateId: settlementId,
            aggregateType: 'MerchantSettlement',
            eventType: 'MerchantLoyaltyOffsetRequested',
            version: 1,
            occurredAt: now,
            payload: {
              settlementId,
              restaurantId: cmd.restaurantId,
              maxOffsetGbp: formatGbp(cashReceivable),
              markPaidReference: cmd.markPaidReference,
            } satisfies MerchantLoyaltyOffsetRequestedPayload,
            metadata: {
              requestId: this.request.requestId,
              actorId: this.request.actorId,
              restaurantId: cmd.restaurantId,
            },
          },
        ]);
      }

      return ok({
        settlementId,
        netPayoutGbp: formatGbp(netPayout),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
