import {
  type DbExecutor,
  LoyaltyLedgerTable,
  LoyaltyProgramPolicyTable,
  sqlSelect,
  sqlUpdate,
  type UnitOfWork,
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
  private readonly uow: UnitOfWork;
  private readonly repo: LoyaltyRepository;
  private readonly clock: ClockPort;

  constructor(uow: UnitOfWork, repo: LoyaltyRepository, clock: ClockPort) {
    this.uow = uow;
    this.repo = repo;
    this.clock = clock;
  }

  private runInTx<T>(
    externalTx: DbExecutor | undefined,
    work: (tx: DbExecutor) => Promise<T>,
  ): Promise<T> {
    return externalTx ? work(externalTx) : this.uow.transaction(work);
  }

  async holdCheckoutPoints(
    input: HoldCheckoutPointsInput,
    actorId: string,
    externalTx?: DbExecutor,
  ): Promise<Result<HeldPointsQuote>> {
    const issuerMerchantId = input.issuerScope === 'MERCHANT' ? input.restaurantId : null;
    const policy = await this.repo.getProgramPolicy(input.issuerScope, issuerMerchantId);

    return await this.runInTx(externalTx, async (tx) => {
      await tx.executeRaw(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `loyalty:CUSTOMER:${input.userId}:${input.issuerScope}:${issuerMerchantId ?? 'PLATFORM'}`,
      ]);

      const state = await this.repo.loadWalletState(
        {
          holderType: 'CUSTOMER',
          holderId: input.userId,
          issuerScope: input.issuerScope,
          issuerMerchantId,
        },
        tx,
      );

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

      await this.repo.appendEntry(
        {
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
        },
        tx,
      );

      const discountGbp = roundGbp(policy.gbpPerPoint.mul(input.pointsToHold));
      return ok({
        pointsHeld: input.pointsToHold,
        discountGbp,
        issuerScope: input.issuerScope,
      });
    });
  }

  async releaseCheckoutHold(
    orderId: string,
    userId: string,
    reason: string,
    actorId: string,
    externalTx?: DbExecutor,
  ): Promise<void> {
    const lCols = LoyaltyLedgerTable.cols;

    await this.runInTx(externalTx, async (tx) => {
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

      const rows = await tx.queryMany(q);
      for (const row of rows) {
        await this.repo.updateEntryStatus(row.id, 'RELEASED', actorId, reason, tx);
        await this.repo.appendEntry(
          {
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
          },
          tx,
        );
      }
    });
  }

  async settleOrderLoyalty(params: {
    readonly orderId: string;
    readonly userId: string;
    readonly restaurantId: string;
    readonly netFoodSubtotalGbp: Decimal;
    readonly allowLoyaltyEarn: boolean;
    readonly actorId: string;
    readonly tx?: DbExecutor;
  }): Promise<void> {
    const policy = params.allowLoyaltyEarn
      ? await this.repo.getProgramPolicy('PLATFORM', null)
      : null;

    await this.runInTx(params.tx, async (tx) => {
      const lCols = LoyaltyLedgerTable.cols;
      const holdQ = sqlSelect(LoyaltyLedgerTable)
        .select([
          lCols.id,
        ])
        .whereEq(lCols.orderId, params.orderId)
        .whereEq(lCols.holderId, params.userId)
        .whereEq(lCols.status, 'HELD')
        .activeOnly()
        .compile();
      const holds = await tx.queryMany(holdQ);
      for (const hold of holds) {
        await this.repo.updateEntryStatus(hold.id, 'REDEEMED', params.actorId, undefined, tx);
      }

      if (!policy || !params.allowLoyaltyEarn || params.netFoodSubtotalGbp.lte(0)) return;
      if (policy.status === 'FROZEN') return;

      const pointsEarned = policy.pointsPerGbp.mul(params.netFoodSubtotalGbp).floor().toNumber();
      if (pointsEarned <= 0) return;

      const now = this.clock.now();
      const maturesAt = new Date(now.getTime() + policy.maturationDays * DAY_MS);
      const expiresAt = new Date(maturesAt.getTime() + policy.expiryDays * DAY_MS);

      await this.repo.appendEntry(
        {
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
        },
        tx,
      );
    });
  }

  async redeemMerchantPointsForFeeOffset(params: {
    readonly restaurantId: string;
    readonly settlementId: string;
    readonly maxOffsetGbp: Decimal;
    readonly actorId: string;
    readonly tx?: DbExecutor;
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
    return await this.runInTx(params.tx, async (tx) => {
      await tx.executeRaw(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `loyalty:MERCHANT:${params.restaurantId}:PLATFORM:PLATFORM`,
      ]);
      const wallet = await this.repo.loadWalletState(
        {
          holderType: 'MERCHANT',
          holderId: params.restaurantId,
          issuerScope: 'PLATFORM',
          issuerMerchantId: null,
        },
        tx,
      );
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
      await this.repo.appendEntry(
        {
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
        },
        tx,
      );
      return {
        pointsRedeemed: pointsToRedeem,
        offsetGbp,
      };
    });
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
  private readonly uow: UnitOfWork;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(uow: UnitOfWork, authz: AuthorizationPolicy, request: RequestContext) {
    this.uow = uow;
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
      const access = this.authz.assertRestaurantAccess(
        cmd.restaurantId,
        'pricing:policy:manage',
        'platform:support:loyalty-governance',
      );
      if (!access.ok) return access;
    }

    const pCols = LoyaltyProgramPolicyTable.cols;
    const builder = sqlUpdate(LoyaltyProgramPolicyTable)
      .set({
        status: cmd.status,
        freezeExpiry: cmd.freezeExpiry ?? cmd.status === 'FROZEN',
        statusReason: cmd.statusReason.trim(),
      })
      .withAuditBump(this.request.actorId)
      .whereEq(pCols.issuerScope, cmd.issuerScope)
      .whereNull(pCols.deletedAt);

    if (cmd.issuerScope === 'MERCHANT' && cmd.restaurantId) {
      builder.whereEq(pCols.restaurantId, cmd.restaurantId);
    } else {
      builder.whereNull(pCols.restaurantId);
    }

    await this.uow.execute(builder.compile());
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
  private readonly uow: UnitOfWork;
  private readonly repo: LoyaltyRepository;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    uow: UnitOfWork,
    repo: LoyaltyRepository,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.uow = uow;
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
    const row = await this.uow.queryOne(sel);
    if (!row) {
      return err(new DomainError('ENTRY_NOT_FOUND', 'Loyalty ledger entry not found.', 404));
    }

    if (cmd.action === 'REVOKE') {
      await this.uow.transaction(async (tx) => {
        await this.repo.updateEntryStatus(row.id, 'REVOKED', this.request.actorId, cmd.reason, tx);
        await this.repo.appendEntry(
          {
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
          },
          tx,
        );
      });
      return ok(undefined);
    }

    const nextStatus: LoyaltyEntryStatus = cmd.action === 'HOLD' ? 'AUDIT_HOLD' : 'AVAILABLE';
    await this.repo.updateEntryStatus(row.id, nextStatus, this.request.actorId, cmd.reason);
    return ok(undefined);
  }
}
