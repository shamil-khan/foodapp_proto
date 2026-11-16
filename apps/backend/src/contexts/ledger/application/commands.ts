import * as crypto from 'node:crypto';
import { LoyaltyLedgerTable, sqlSelect } from '@foodapp/db';
import type { Pool } from 'pg';
import { FinancialLedgerAggregate } from '@/contexts/ledger/domain/ledger-aggregate';
import type { LedgerRepository } from '@/contexts/ledger/infrastructure/ledger-repository';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export interface RecordOrderSettlementCommand
  extends Command<
    Result<{
      ledgerId: string;
    }>
  > {
  readonly orderId: string;
  readonly restaurantId: string;
  readonly subtotal: number;
  readonly vatTotal: number;
  readonly tipAmount?: number;
  readonly totalAmount: number;
}

export class RecordOrderSettlementHandler
  implements
    CommandHandler<
      RecordOrderSettlementCommand,
      Result<{
        ledgerId: string;
      }>
    >
{
  constructor(
    private readonly ledgerRepo: LedgerRepository,
    private readonly request: RequestContext,
  ) {}

  async execute(cmd: RecordOrderSettlementCommand): Promise<
    Result<{
      ledgerId: string;
    }>
  > {
    const feeRate = await this.ledgerRepo.getRestaurantFeeRate(cmd.restaurantId);
    const ledgerId = crypto.randomUUID();

    const aggregateResult = FinancialLedgerAggregate.recordOrderSettlement(
      ledgerId,
      {
        orderId: cmd.orderId,
        restaurantId: cmd.restaurantId,
        subtotal: cmd.subtotal,
        vatTotal: cmd.vatTotal,
        tipAmount: cmd.tipAmount,
        totalAmount: cmd.totalAmount,
        platformFeeRate: feeRate,
      },
      {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId: cmd.restaurantId,
      },
    );

    if (!aggregateResult.ok) {
      return aggregateResult;
    }

    await this.ledgerRepo.saveSettlement(aggregateResult.value);
    return ok({
      ledgerId,
    });
  }
}

export interface RedeemLoyaltyPointsCommand
  extends Command<
    Result<{
      remainingBalance: number;
    }>
  > {
  readonly userId: string;
  readonly restaurantId?: string;
  readonly orderId?: string;
  readonly pointsToRedeem: number;
}

export class RedeemLoyaltyPointsHandler
  implements
    CommandHandler<
      RedeemLoyaltyPointsCommand,
      Result<{
        remainingBalance: number;
      }>
    >
{
  constructor(
    private readonly pool: Pool,
    private readonly ledgerRepo: LedgerRepository,
    private readonly authz: AuthorizationPolicy,
    private readonly request: RequestContext,
  ) {}

  async execute(cmd: RedeemLoyaltyPointsCommand): Promise<
    Result<{
      remainingBalance: number;
    }>
  > {
    const access = this.authz.assertUserAccess(cmd.userId, 'loyalty:redeem');
    if (!access.ok) {
      return access;
    }

    if (cmd.pointsToRedeem <= 0) {
      return err(new DomainError('INVALID_POINTS', 'Points to redeem must be positive.'));
    }

    const { cols } = LoyaltyLedgerTable;
    const balanceQuery = sqlSelect(LoyaltyLedgerTable)
      .select([
        cols.pointsDelta,
      ])
      .whereEq(cols.userId, cmd.userId)
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof balanceQuery._result>(
      balanceQuery.text,
      balanceQuery.params,
    );

    const currentBalance = rows.reduce((sum, r) => sum + r.pointsDelta, 0);
    if (currentBalance < cmd.pointsToRedeem) {
      return err(
        new DomainError(
          'INSUFFICIENT_POINTS',
          `Available balance (${currentBalance}) is less than ${cmd.pointsToRedeem} points.`,
        ),
      );
    }

    await this.ledgerRepo.recordLoyaltyTransaction({
      userId: cmd.userId,
      restaurantId: cmd.restaurantId,
      orderId: cmd.orderId,
      txType: 'REDEEMED',
      pointsDelta: -Math.abs(cmd.pointsToRedeem),
      actorId: this.request.actorId,
    });

    return ok({
      remainingBalance: currentBalance - cmd.pointsToRedeem,
    });
  }
}
