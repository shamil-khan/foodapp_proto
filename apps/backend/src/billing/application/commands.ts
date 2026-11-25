import * as crypto from 'node:crypto';
import {
  type DbExecutor,
  FinancialLedgerTable,
  MerchantSettlementTable,
  OrderTable,
  RestaurantBranchTable,
  RestaurantTable,
  sqlSelect,
  sqlUpdate,
  type UnitOfWork,
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
import type { DomainEvent } from '@/core/domain/domain-event';
import { formatGbp, money, roundGbp } from '@/core/domain/money';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export class BillingSettlementService {
  private readonly uow: UnitOfWork;
  private readonly repo: BillingRepository;
  private readonly eventBus: EventBus;
  private readonly vatStrategy = new UkStandardVatStrategy();

  constructor(uow: UnitOfWork, repo: BillingRepository, eventBus: EventBus) {
    this.uow = uow;
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
    readonly tx?: DbExecutor;
    readonly deferPublish?: boolean;
  }): Promise<Result<readonly DomainEvent<unknown>[]>> {
    const exec = params.tx ?? this.uow;
    const rCols = RestaurantTable.cols;
    const rQ = sqlSelect(RestaurantTable)
      .select([
        rCols.platformFeeRate,
      ])
      .whereEq(rCols.id, params.restaurantId)
      .activeOnly()
      .compile();
    const rRow = await exec.queryOne(rQ);
    const commissionRate = new Decimal(rRow?.platformFeeRate ?? '15.00');
    const commissionNet = roundGbp(params.subtotalGbp.mul(commissionRate).div(100));
    const commissionVat = this.vatStrategy.calculateCommissionVat(commissionNet);

    const state = await this.repo.loadRestaurantLedgerState(params.restaurantId, exec);
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
    const writeLines = async (workTx: DbExecutor): Promise<void> => {
      for (const ev of events) {
        if (ev.eventType === 'BillingSettlementRecorded') {
          const p = ev.payload as BillingSettlementRecordedPayload;
          await this.repo.appendJournalLines(
            {
              orderId: p.orderId,
              branchId: p.branchId,
              restaurantId: p.restaurantId,
              lines: p.journalLines,
              actorId: params.actorId,
            },
            workTx,
          );
        }
      }
    };

    if (params.tx) {
      await writeLines(params.tx);
    } else {
      await this.uow.transaction(writeLines);
    }

    if (!params.deferPublish) {
      await this.eventBus.publish(events);
    }
    return ok(events);
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
  private readonly uow: UnitOfWork;
  private readonly repo: BillingRepository;
  private readonly gateway: PaymentGatewayPort;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    repo: BillingRepository,
    gateway: PaymentGatewayPort,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
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
    const order = await this.uow.queryOne(oQ);
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

    let restaurantId = this.request.restaurantId ?? this.request.supportGrant?.restaurantId ?? '';
    if (!restaurantId) {
      const bCols = RestaurantBranchTable.cols;
      const bQ = sqlSelect(RestaurantBranchTable)
        .select([
          bCols.restaurantId,
        ])
        .whereEq(bCols.id, order.branchId)
        .activeOnly()
        .compile();
      const branchRow = await this.uow.queryOne(bQ);
      restaurantId = branchRow?.restaurantId ?? '';
    }

    const fCols = FinancialLedgerTable.cols;
    const prevRefundQ = sqlSelect(FinancialLedgerTable)
      .select([
        fCols.debitAmount,
      ])
      .whereEq(fCols.orderId, order.id)
      .whereEq(fCols.accountCode, 'MERCHANT_PAYABLE')
      .activeOnly()
      .compile();

    try {
      const outcome = await this.uow.transaction(async (tx) => {
        await tx.executeRaw(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `refund:order:${order.id}`,
        ]);

        const prevRefundRows = await tx.queryMany(prevRefundQ);
        const alreadyRefunded = prevRefundRows.reduce(
          (acc, r) => acc.plus(new Decimal(r.debitAmount)),
          new Decimal(0),
        );
        if (alreadyRefunded.plus(refundAmt).gt(grossTotal)) {
          return null;
        }

        const gwRes = await this.gateway.refundCharge({
          providerReference: order.idempotencyKey ?? order.id,
          amountGbp: refundAmt,
          reason: cmd.reason,
        });
        if (gwRes.status === 'FAILED') {
          throw new DomainError('GATEWAY_REFUND_FAILED', 'Payment gateway rejected refund.', 502);
        }

        await this.repo.appendJournalLines(
          {
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
          },
          tx,
        );

        return {
          refundReference: gwRes.refundReference,
        };
      });

      if (!outcome) {
        return err(
          new DomainError('INVALID_REFUND', 'Cumulative refund amount exceeds order total.', 400),
        );
      }

      return ok(outcome);
    } catch (error) {
      if (error instanceof DomainError) return err(error);
      throw error;
    }
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
  private readonly uow: UnitOfWork;
  private readonly repo: BillingRepository;
  private readonly eventBus: EventBus;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    repo: BillingRepository,
    eventBus: EventBus,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
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
    const rest = await this.uow.queryOne(rQ);
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
    const now = new Date();

    // Atomically create MerchantSettlement and bind all unsettled FinancialLedger rows
    const settlementId = await this.uow.transaction(async (tx) => {
      const createdId = await this.repo.createMerchantSettlement(
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
        tx,
      );

      if (cmd.markPaidReference && !shouldRequestOffset) {
        const mCols = MerchantSettlementTable.cols;
        const markPaid = sqlUpdate(MerchantSettlementTable)
          .set({
            payoutReference: cmd.markPaidReference,
            paidAt: now,
          })
          .withAuditBump(this.request.actorId)
          .whereEq(mCols.id, createdId)
          .compile();
        await tx.execute(markPaid);
      }

      return createdId;
    });

    // Publish loyalty fee offset request post-commit so Loyalty consumer sees committed settlement row
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
  }
}
