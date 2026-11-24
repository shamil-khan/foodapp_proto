import {
  LoyaltyLedgerTable,
  LoyaltyProgramPolicyTable,
  type Pool,
  sqlSelect,
  sqlUpdate,
} from '@foodapp/db';
import type Decimal from 'decimal.js';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { roundGbp } from '@/core/domain/money';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type {
  ClockPort,
  HeldPointsQuote,
  HoldCheckoutPointsInput,
  LoyaltySettlementPort,
} from '@/loyalty/application/loyalty-ports';
import { LoyaltyWalletAggregate } from '@/loyalty/domain/loyalty-aggregate';
import type {
  LoyaltyEntryStatus,
  LoyaltyIssuerScope,
  LoyaltyProgramStatus,
} from '@/loyalty/domain/loyalty-events';
import type { LoyaltyRepository } from '@/loyalty/infrastructure/loyalty-repository';

const DAY_MS = 86_400_000;

export class LoyaltySettlementService implements LoyaltySettlementPort {
  private readonly pool: Pool;
  private readonly repo: LoyaltyRepository;
  private readonly clock: ClockPort;

  constructor(pool: Pool, repo: LoyaltyRepository, clock: ClockPort) {
    this.pool = pool;
    this.repo = repo;
    this.clock = clock;
  }

  async holdCheckoutPoints(
    input: HoldCheckoutPointsInput,
    actorId: string,
  ): Promise<Result<HeldPointsQuote>> {
    const issuerMerchantId = input.issuerScope === 'MERCHANT' ? input.restaurantId : null;
    const policy = await this.repo.getProgramPolicy(input.issuerScope, issuerMerchantId);
    const state = await this.repo.loadWalletState({
      holderType: 'CUSTOMER',
      holderId: input.userId,
      issuerScope: input.issuerScope,
      issuerMerchantId,
    });

    const wallet = LoyaltyWalletAggregate.fromSnapshot(input.userId, state);
    const holdRes = wallet.holdForCheckout(
      {
        orderId: input.orderId,
        pointsToHold: input.pointsToHold,
        programStatus: policy.status,
        allowLoyaltyRedeem: input.allowLoyaltyRedeem,
      },
      {
        actorId,
        restaurantId: input.restaurantId,
      },
    );
    if (!holdRes.ok) return holdRes;

    await this.repo.appendEntry({
      userId: input.userId,
      holderType: 'CUSTOMER',
      holderId: input.userId,
      orderId: input.orderId,
      issuerScope: input.issuerScope,
      issuerMerchantId,
      txType: 'HELD',
      sourceType: 'ORDER_REDEEM_HOLD',
      status: 'HELD',
      pointsDelta: -Math.abs(input.pointsToHold),
      actorId,
    });

    const discountGbp = roundGbp(policy.gbpPerPoint.mul(input.pointsToHold));
    return ok({
      pointsHeld: input.pointsToHold,
      discountGbp,
      issuerScope: input.issuerScope,
    });
  }

  async releaseCheckoutHold(
    orderId: string,
    userId: string,
    reason: string,
    actorId: string,
  ): Promise<void> {
    const lCols = LoyaltyLedgerTable.cols;
    const q = sqlSelect(LoyaltyLedgerTable)
      .select([
        lCols.id,
        lCols.pointsDelta,
        lCols.issuerScope,
        lCols.issuerMerchantId,
      ])
      .whereEq(lCols.orderId, orderId)
      .whereEq(lCols.holderId, userId)
      .whereEq(lCols.status, 'HELD')
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
    for (const row of rows) {
      await this.repo.updateEntryStatus(row.id, 'RELEASED', actorId, reason);
      await this.repo.appendEntry({
        userId,
        holderType: 'CUSTOMER',
        holderId: userId,
        orderId,
        issuerScope: row.issuerScope as LoyaltyIssuerScope,
        issuerMerchantId: row.issuerMerchantId,
        txType: 'RELEASED',
        sourceType: 'ORDER_HOLD_RELEASE',
        status: 'RELEASED',
        pointsDelta: Math.abs(row.pointsDelta),
        referenceEntryId: row.id,
        auditReason: reason,
        actorId,
      });
    }
  }
  async settleOrderLoyalty(params: {
    readonly orderId: string;
    readonly userId: string;
    readonly restaurantId: string;
    readonly netFoodSubtotalGbp: Decimal;
    readonly allowLoyaltyEarn: boolean;
    readonly actorId: string;
  }): Promise<void> {
    const lCols = LoyaltyLedgerTable.cols;
    const holdQ = sqlSelect(LoyaltyLedgerTable)
      .select([
        lCols.id,
        lCols.pointsDelta,
        lCols.issuerScope,
        lCols.issuerMerchantId,
      ])
      .whereEq(lCols.orderId, params.orderId)
      .whereEq(lCols.holderId, params.userId)
      .whereEq(lCols.status, 'HELD')
      .activeOnly()
      .compile();
    const { rows: holds } = await this.pool.query<typeof holdQ._result>(holdQ.text, holdQ.params);
    for (const hold of holds) {
      await this.repo.updateEntryStatus(hold.id, 'REDEEMED', params.actorId);
    }

    if (!params.allowLoyaltyEarn || params.netFoodSubtotalGbp.lte(0)) return;

    const policy = await this.repo.getProgramPolicy('PLATFORM', null);
    if (policy.status === 'FROZEN') return;

    const pointsEarned = policy.pointsPerGbp.mul(params.netFoodSubtotalGbp).floor().toNumber();
    if (pointsEarned <= 0) return;

    const now = this.clock.now();
    const maturesAt = new Date(now.getTime() + policy.maturationDays * DAY_MS);
    const expiresAt = new Date(maturesAt.getTime() + policy.expiryDays * DAY_MS);

    await this.repo.appendEntry({
      userId: params.userId,
      holderType: 'CUSTOMER',
      holderId: params.userId,
      orderId: params.orderId,
      issuerScope: 'PLATFORM',
      txType: 'EARNED',
      sourceType: 'ORDER_EARN',
      status: 'PENDING_MATURATION',
      pointsDelta: pointsEarned,
      maturesAt,
      expiresAt,
      actorId: params.actorId,
    });
  }

  async redeemMerchantPointsForFeeOffset(params: {
    readonly restaurantId: string;
    readonly settlementId: string;
    readonly maxOffsetGbp: Decimal;
    readonly actorId: string;
  }): Promise<{
    readonly pointsRedeemed: number;
    readonly offsetGbp: Decimal;
  }> {
    const policy = await this.repo.getProgramPolicy('PLATFORM', null);
    if (policy.status !== 'ACTIVE' || params.maxOffsetGbp.lte(0)) {
      return {
        pointsRedeemed: 0,
        offsetGbp: roundGbp(0),
      };
    }
    const wallet = await this.repo.loadWalletState({
      holderType: 'MERCHANT',
      holderId: params.restaurantId,
      issuerScope: 'PLATFORM',
      issuerMerchantId: null,
    });
    if (wallet.availablePoints <= 0) {
      return {
        pointsRedeemed: 0,
        offsetGbp: roundGbp(0),
      };
    }
    const maxPointsNeeded = params.maxOffsetGbp.div(policy.gbpPerPoint).floor().toNumber();
    const pointsToRedeem = Math.min(wallet.availablePoints, maxPointsNeeded);
    if (pointsToRedeem <= 0) {
      return {
        pointsRedeemed: 0,
        offsetGbp: roundGbp(0),
      };
    }
    const offsetGbp = roundGbp(policy.gbpPerPoint.mul(pointsToRedeem));
    await this.repo.appendEntry({
      userId: params.actorId,
      holderType: 'MERCHANT',
      holderId: params.restaurantId,
      issuerScope: 'PLATFORM',
      txType: 'REDEEMED',
      sourceType: 'B2B_SETTLEMENT_OFFSET',
      status: 'REDEEMED',
      pointsDelta: -pointsToRedeem,
      auditReason: `Applied to MerchantSettlement ${params.settlementId}`,
      actorId: params.actorId,
    });
    return {
      pointsRedeemed: pointsToRedeem,
      offsetGbp,
    };
  }
}

export interface UpdateLoyaltyGovernanceCommand extends Command<Result<void>> {
  readonly issuerScope: LoyaltyIssuerScope;
  readonly restaurantId?: string | null;
  readonly status: LoyaltyProgramStatus;
  readonly freezeExpiry?: boolean;
  readonly statusReason: string;
}

export class UpdateLoyaltyGovernanceHandler
  implements CommandHandler<UpdateLoyaltyGovernanceCommand, Result<void>>
{
  private readonly pool: Pool;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(pool: Pool, authz: AuthorizationPolicy, request: RequestContext) {
    this.pool = pool;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: UpdateLoyaltyGovernanceCommand): Promise<Result<void>> {
    if (cmd.issuerScope === 'PLATFORM' && !this.authz.isPlatformAdmin()) {
      return err(
        new DomainError('FORBIDDEN', 'Platform admin required for platform loyalty freeze.', 403),
      );
    }
    if (cmd.issuerScope === 'MERCHANT') {
      if (!cmd.restaurantId) {
        return err(new DomainError('MISSING_TENANT', 'restaurantId is required.', 400));
      }
      const access = this.authz.assertRestaurantAccess(cmd.restaurantId, 'pricing:policy:manage');
      if (!access.ok) return access;
    }

    const pCols = LoyaltyProgramPolicyTable.cols;
    const upd = sqlUpdate(LoyaltyProgramPolicyTable)
      .set({
        status: cmd.status,
        freezeExpiry: cmd.freezeExpiry ?? cmd.status === 'FROZEN',
        statusReason: cmd.statusReason.trim(),
      })
      .withAuditBump(this.request.actorId)
      .whereEq(pCols.issuerScope, cmd.issuerScope)
      .whereNull(pCols.deletedAt)
      .compile();

    await this.pool.query(upd.text, upd.params);
    return ok(undefined);
  }
}

export interface AuditLoyaltyEntryCommand extends Command<Result<void>> {
  readonly entryId: string;
  readonly action: 'HOLD' | 'APPROVE' | 'REVOKE';
  readonly reason: string;
}

export class AuditLoyaltyEntryHandler
  implements CommandHandler<AuditLoyaltyEntryCommand, Result<void>>
{
  private readonly pool: Pool;
  private readonly repo: LoyaltyRepository;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    pool: Pool,
    repo: LoyaltyRepository,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.pool = pool;
    this.repo = repo;
    this.authz = authz;
    this.request = request;
  }

  async execute(cmd: AuditLoyaltyEntryCommand): Promise<Result<void>> {
    if (!this.authz.isPlatformAdmin()) {
      return err(
        new DomainError('FORBIDDEN', 'Platform admin required for loyalty audit actions.', 403),
      );
    }
    const lCols = LoyaltyLedgerTable.cols;
    const sel = sqlSelect(LoyaltyLedgerTable).whereEq(lCols.id, cmd.entryId).activeOnly().compile();
    const row = (await this.pool.query<typeof sel._result>(sel.text, sel.params)).rows[0];
    if (!row) {
      return err(new DomainError('ENTRY_NOT_FOUND', 'Loyalty ledger entry not found.', 404));
    }

    if (cmd.action === 'REVOKE') {
      await this.repo.updateEntryStatus(row.id, 'REVOKED', this.request.actorId, cmd.reason);
      await this.repo.appendEntry({
        userId: row.userId,
        holderType: row.holderType as 'CUSTOMER' | 'MERCHANT',
        holderId: row.holderId ?? row.userId,
        orderId: row.orderId,
        issuerScope: row.issuerScope as LoyaltyIssuerScope,
        issuerMerchantId: row.issuerMerchantId,
        txType: 'REVOKED',
        sourceType: 'AUDIT_CLAWBACK',
        status: 'REVOKED',
        pointsDelta: -Math.abs(row.pointsDelta),
        referenceEntryId: row.id,
        auditReason: cmd.reason,
        actorId: this.request.actorId,
      });
      return ok(undefined);
    }

    const nextStatus: LoyaltyEntryStatus = cmd.action === 'HOLD' ? 'AUDIT_HOLD' : 'AVAILABLE';
    await this.repo.updateEntryStatus(row.id, nextStatus, this.request.actorId, cmd.reason);
    return ok(undefined);
  }
}
