import { AggregateRoot } from '@/core/domain/aggregate-root';
import type { DomainEvent, EventMetadata } from '@/core/domain/domain-event';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type {
  LoyaltyHolderType,
  LoyaltyIssuerScope,
  LoyaltyProgramStatus,
  PointsAccruedPendingPayload,
  PointsHeldPayload,
  PointsRedeemedPayload,
  PointsReleasedPayload,
  PointsRevokedPayload,
} from '@/loyalty/domain/loyalty-events';

export interface LoyaltyWalletState {
  holderType: LoyaltyHolderType;
  holderId: string;
  issuerScope: LoyaltyIssuerScope;
  issuerMerchantId: string | null;
  availablePoints: number;
  heldPoints: number;
  pendingMaturationPoints: number;
}

const INITIAL_WALLET_STATE: LoyaltyWalletState = {
  holderType: 'CUSTOMER',
  holderId: '',
  issuerScope: 'PLATFORM',
  issuerMerchantId: null,
  availablePoints: 0,
  heldPoints: 0,
  pendingMaturationPoints: 0,
};

export class LoyaltyWalletAggregate extends AggregateRoot<LoyaltyWalletState> {
  private constructor(
    id: string,
    state: LoyaltyWalletState = structuredClone(INITIAL_WALLET_STATE),
  ) {
    super(id, 'LoyaltyWalletAggregate', state);
  }

  public static fromSnapshot(id: string, state: LoyaltyWalletState): LoyaltyWalletAggregate {
    return new LoyaltyWalletAggregate(id, state);
  }

  public holdForCheckout(
    params: {
      orderId: string;
      pointsToHold: number;
      programStatus: LoyaltyProgramStatus;
      allowLoyaltyRedeem: boolean;
    },
    metadata: EventMetadata,
  ): Result<void> {
    if (!params.allowLoyaltyRedeem) {
      return err(
        new DomainError(
          'PROMO_BLOCKS_REDEEM',
          'Applied promotion excludes loyalty redemption.',
          400,
        ),
      );
    }
    if (params.programStatus !== 'ACTIVE') {
      return err(
        new DomainError(
          'LOYALTY_PROGRAM_UNAVAILABLE',
          `Loyalty redemption blocked while program status is ${params.programStatus}.`,
          403,
        ),
      );
    }
    if (params.pointsToHold <= 0 || !Number.isInteger(params.pointsToHold)) {
      return err(
        new DomainError('INVALID_POINTS', 'Points to hold must be a positive integer.', 400),
      );
    }
    if (this.state.availablePoints < params.pointsToHold) {
      return err(
        new DomainError(
          'INSUFFICIENT_POINTS',
          `Available balance (${this.state.availablePoints}) is less than ${params.pointsToHold} points.`,
          400,
        ),
      );
    }

    this.raiseEvent<PointsHeldPayload>(
      'PointsHeld',
      {
        holderType: this.state.holderType,
        holderId: this.state.holderId,
        issuerScope: this.state.issuerScope,
        issuerMerchantId: this.state.issuerMerchantId,
        orderId: params.orderId,
        pointsHeld: params.pointsToHold,
      },
      metadata,
    );
    return ok(undefined);
  }

  public commitHeldPoints(
    orderId: string,
    pointsHeld: number,
    metadata: EventMetadata,
  ): Result<void> {
    if (pointsHeld <= 0) return ok(undefined);
    this.raiseEvent<PointsRedeemedPayload>(
      'PointsRedeemed',
      {
        holderType: this.state.holderType,
        holderId: this.state.holderId,
        issuerScope: this.state.issuerScope,
        issuerMerchantId: this.state.issuerMerchantId,
        orderId,
        pointsRedeemed: pointsHeld,
      },
      metadata,
    );
    return ok(undefined);
  }

  public releaseHeldPoints(
    orderId: string,
    pointsHeld: number,
    reason: string,
    metadata: EventMetadata,
  ): Result<void> {
    if (pointsHeld <= 0) return ok(undefined);
    this.raiseEvent<PointsReleasedPayload>(
      'PointsReleased',
      {
        holderId: this.state.holderId,
        orderId,
        pointsReleased: pointsHeld,
        reason,
      },
      metadata,
    );
    return ok(undefined);
  }

  public accruePendingPoints(
    params: {
      orderId: string | null;
      sourceType: string;
      pointsEarned: number;
      maturesAt: Date;
      expiresAt: Date;
    },
    metadata: EventMetadata,
  ): Result<void> {
    if (params.pointsEarned <= 0) return ok(undefined);
    this.raiseEvent<PointsAccruedPendingPayload>(
      'PointsAccruedPending',
      {
        holderType: this.state.holderType,
        holderId: this.state.holderId,
        issuerScope: this.state.issuerScope,
        issuerMerchantId: this.state.issuerMerchantId,
        orderId: params.orderId,
        sourceType: params.sourceType,
        pointsEarned: params.pointsEarned,
        maturesAt: params.maturesAt.toISOString(),
        expiresAt: params.expiresAt.toISOString(),
      },
      metadata,
    );
    return ok(undefined);
  }

  public revokePoints(
    referenceEntryId: string,
    pointsToRevoke: number,
    auditReason: string,
    metadata: EventMetadata,
  ): Result<void> {
    if (pointsToRevoke <= 0) {
      return err(new DomainError('INVALID_POINTS', 'Points to revoke must be positive.', 400));
    }
    // Append-only clawback is allowed even if post-spend balance goes negative (blocks future redeems)
    this.raiseEvent<PointsRevokedPayload>(
      'PointsRevoked',
      {
        holderId: this.state.holderId,
        referenceEntryId,
        pointsRevoked: pointsToRevoke,
        auditReason,
      },
      metadata,
    );
    return ok(undefined);
  }

  protected apply(event: DomainEvent<unknown>): void {
    switch (event.eventType) {
      case 'PointsHeld': {
        const p = event.payload as PointsHeldPayload;
        this.state.availablePoints -= p.pointsHeld;
        this.state.heldPoints += p.pointsHeld;
        break;
      }
      case 'PointsRedeemed': {
        const p = event.payload as PointsRedeemedPayload;
        this.state.heldPoints = Math.max(0, this.state.heldPoints - p.pointsRedeemed);
        break;
      }
      case 'PointsReleased': {
        const p = event.payload as PointsReleasedPayload;
        this.state.heldPoints = Math.max(0, this.state.heldPoints - p.pointsReleased);
        this.state.availablePoints += p.pointsReleased;
        break;
      }
      case 'PointsAccruedPending': {
        const p = event.payload as PointsAccruedPendingPayload;
        this.state.pendingMaturationPoints += p.pointsEarned;
        break;
      }
      case 'PointsRevoked': {
        const p = event.payload as PointsRevokedPayload;
        this.state.availablePoints -= p.pointsRevoked;
        break;
      }
    }
  }

  public get snapshot(): Readonly<LoyaltyWalletState> {
    return this.state;
  }
}
