import {
  type DbExecutor,
  LoyaltyLedgerTable,
  LoyaltyProgramPolicyTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
  type UnitOfWork,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import type { RequestContext } from '@/core/application/authorization';
import { ScopedRepository } from '@/core/infrastructure/scoped-repository';
import type { LoyaltyWalletState } from '@/loyalty/domain/loyalty-aggregate';
import type {
  LoyaltyEntryStatus,
  LoyaltyHolderType,
  LoyaltyIssuerScope,
  LoyaltyProgramStatus,
} from '@/loyalty/domain/loyalty-events';

export interface LoyaltyPolicyRecord {
  readonly id: string;
  readonly issuerScope: LoyaltyIssuerScope;
  readonly restaurantId: string | null;
  readonly status: LoyaltyProgramStatus;
  readonly maturationDays: number;
  readonly expiryDays: number;
  readonly freezeExpiry: boolean;
  readonly pointsPerGbp: Decimal;
  readonly gbpPerPoint: Decimal;
}

export class LoyaltyRepository extends ScopedRepository {
  private readonly uow: UnitOfWork;

  constructor(uow: UnitOfWork, request: RequestContext) {
    super(request);
    this.uow = uow;
  }

  async getProgramPolicy(
    issuerScope: LoyaltyIssuerScope,
    restaurantId: string | null,
  ): Promise<LoyaltyPolicyRecord> {
    const pCols = LoyaltyProgramPolicyTable.cols;
    const builder = sqlSelect(LoyaltyProgramPolicyTable)
      .whereEq(pCols.issuerScope, issuerScope)
      .activeOnly();

    if (issuerScope === 'MERCHANT' && restaurantId) {
      builder.whereEq(pCols.restaurantId, restaurantId);
    } else {
      builder.whereNull(pCols.restaurantId);
    }

    const q = builder.take(1).compile();
    const row = await this.uow.queryOne(q);

    if (!row) {
      return {
        id: 'default-policy',
        issuerScope,
        restaurantId,
        status: 'ACTIVE',
        maturationDays: 14,
        expiryDays: 365,
        freezeExpiry: false,
        pointsPerGbp: new Decimal(10),
        gbpPerPoint: new Decimal('0.01'),
      };
    }

    return {
      id: row.id,
      issuerScope: row.issuerScope as LoyaltyIssuerScope,
      restaurantId: row.restaurantId,
      status: row.status as LoyaltyProgramStatus,
      maturationDays: row.maturationDays,
      expiryDays: row.expiryDays,
      freezeExpiry: row.freezeExpiry,
      pointsPerGbp: new Decimal(row.pointsPerGbp),
      gbpPerPoint: new Decimal(row.gbpPerPoint),
    };
  }

  async loadWalletState(
    params: {
      holderType: LoyaltyHolderType;
      holderId: string;
      issuerScope: LoyaltyIssuerScope;
      issuerMerchantId: string | null;
    },
    tx: DbExecutor = this.uow,
  ): Promise<LoyaltyWalletState> {
    if (params.holderType === 'CUSTOMER') {
      this.resolveUserScope(params.holderId);
    } else {
      this.resolveRestaurantScope(params.holderId);
    }

    const lCols = LoyaltyLedgerTable.cols;
    const builder = sqlSelect(LoyaltyLedgerTable)
      .select([
        lCols.status,
        lCols.pointsDelta,
      ])
      .whereEq(lCols.holderType, params.holderType)
      .whereEq(lCols.holderId, params.holderId)
      .whereEq(lCols.issuerScope, params.issuerScope)
      .activeOnly();

    if (params.issuerScope === 'MERCHANT' && params.issuerMerchantId) {
      builder.whereEq(lCols.issuerMerchantId, params.issuerMerchantId);
    } else {
      builder.whereNull(lCols.issuerMerchantId);
    }

    const q = builder.compile();
    const rows = await tx.queryMany(q);

    let availablePoints = 0;
    let heldPoints = 0;
    let pendingMaturationPoints = 0;

    for (const r of rows) {
      if (
        r.status === 'AVAILABLE' ||
        r.status === 'REVOKED' ||
        r.status === 'EXPIRED' ||
        r.status === 'REDEEMED'
      ) {
        availablePoints += r.pointsDelta;
      } else if (r.status === 'HELD') {
        heldPoints += Math.abs(r.pointsDelta);
        availablePoints += r.pointsDelta;
      } else if (r.status === 'PENDING_MATURATION' || r.status === 'AUDIT_HOLD') {
        pendingMaturationPoints += r.pointsDelta;
      }
    }

    return {
      holderType: params.holderType,
      holderId: params.holderId,
      issuerScope: params.issuerScope,
      issuerMerchantId: params.issuerMerchantId,
      availablePoints,
      heldPoints,
      pendingMaturationPoints,
    };
  }

  async appendEntry(
    entry: {
      userId: string;
      holderType: LoyaltyHolderType;
      holderId: string;
      branchId?: string | null;
      orderId?: string | null;
      issuerScope: LoyaltyIssuerScope;
      issuerMerchantId?: string | null;
      txType: string;
      sourceType: string;
      status: LoyaltyEntryStatus;
      pointsDelta: number;
      maturesAt?: Date | null;
      expiresAt?: Date | null;
      referenceEntryId?: string | null;
      auditReason?: string | null;
      actorId: string;
    },
    tx: DbExecutor = this.uow,
  ): Promise<string> {
    const lCols = LoyaltyLedgerTable.cols;
    const ins = sqlInsert(LoyaltyLedgerTable)
      .values({
        userId: entry.userId,
        holderType: entry.holderType,
        holderId: entry.holderId,
        branchId: entry.branchId ?? null,
        orderId: entry.orderId ?? null,
        issuerScope: entry.issuerScope,
        issuerMerchantId: entry.issuerMerchantId ?? null,
        txType: entry.txType,
        sourceType: entry.sourceType,
        status: entry.status,
        pointsDelta: entry.pointsDelta,
        maturesAt: entry.maturesAt ?? null,
        expiresAt: entry.expiresAt ?? null,
        referenceEntryId: entry.referenceEntryId ?? null,
        auditReason: entry.auditReason ?? null,
        createdBy: entry.actorId,
        updatedBy: entry.actorId,
      })
      .returning([
        lCols.id,
      ])
      .compile();

    const inserted = await tx.queryOne(ins);
    return inserted?.id ?? '';
  }

  async updateEntryStatus(
    entryId: string,
    status: LoyaltyEntryStatus,
    actorId: string,
    auditReason?: string,
    tx: DbExecutor = this.uow,
  ): Promise<void> {
    const lCols = LoyaltyLedgerTable.cols;
    const upd = sqlUpdate(LoyaltyLedgerTable)
      .set({
        status,
        auditReason: auditReason ?? undefined,
      })
      .withAuditBump(actorId)
      .whereEq(lCols.id, entryId)
      .whereNull(lCols.deletedAt)
      .compile();

    await tx.execute(upd);
  }
}
