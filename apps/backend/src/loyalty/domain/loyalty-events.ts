import type { DomainEvent } from '@/core/domain/domain-event';

export type LoyaltyHolderType = 'CUSTOMER' | 'MERCHANT';
export type LoyaltyIssuerScope = 'PLATFORM' | 'MERCHANT';
export type LoyaltyEntryStatus =
  | 'HELD'
  | 'RELEASED'
  | 'REDEEMED'
  | 'PENDING_MATURATION'
  | 'AVAILABLE'
  | 'AUDIT_HOLD'
  | 'FROZEN'
  | 'EXPIRED'
  | 'REVOKED';

export type LoyaltyProgramStatus = 'ACTIVE' | 'PAUSED_REDEEM' | 'FROZEN';

export interface PointsHeldPayload {
  readonly holderType: LoyaltyHolderType;
  readonly holderId: string;
  readonly issuerScope: LoyaltyIssuerScope;
  readonly issuerMerchantId: string | null;
  readonly orderId: string;
  readonly pointsHeld: number;
}

export interface PointsReleasedPayload {
  readonly holderId: string;
  readonly orderId: string;
  readonly pointsReleased: number;
  readonly reason: string;
}

export interface PointsRedeemedPayload {
  readonly holderType: LoyaltyHolderType;
  readonly holderId: string;
  readonly issuerScope: LoyaltyIssuerScope;
  readonly issuerMerchantId: string | null;
  readonly orderId: string | null;
  readonly pointsRedeemed: number;
}

export interface PointsAccruedPendingPayload {
  readonly holderType: LoyaltyHolderType;
  readonly holderId: string;
  readonly issuerScope: LoyaltyIssuerScope;
  readonly issuerMerchantId: string | null;
  readonly orderId: string | null;
  readonly sourceType: string;
  readonly pointsEarned: number;
  readonly maturesAt: string;
  readonly expiresAt: string;
}

export interface PointsRevokedPayload {
  readonly holderId: string;
  readonly referenceEntryId: string;
  readonly pointsRevoked: number;
  readonly auditReason: string;
}

export interface LoyaltyHoldConfirmedPayload {
  readonly orderId: string;
  readonly userId: string;
  readonly pointsHeld: number;
  readonly discountGbp: string;
  readonly issuerScope: LoyaltyIssuerScope;
}

export interface LoyaltyHoldFailedPayload {
  readonly orderId: string;
  readonly userId: string;
  readonly code: string;
  readonly reason: string;
}

export interface MerchantLoyaltyOffsetAppliedPayload {
  readonly settlementId: string;
  readonly restaurantId: string;
  readonly pointsRedeemed: number;
  readonly offsetGbp: string;
  readonly markPaidReference?: string;
}

export type PointsHeldEvent = DomainEvent<PointsHeldPayload>;
export type PointsReleasedEvent = DomainEvent<PointsReleasedPayload>;
export type PointsRedeemedEvent = DomainEvent<PointsRedeemedPayload>;
export type PointsAccruedPendingEvent = DomainEvent<PointsAccruedPendingPayload>;
export type PointsRevokedEvent = DomainEvent<PointsRevokedPayload>;
export type LoyaltyHoldConfirmedEvent = DomainEvent<LoyaltyHoldConfirmedPayload>;
export type LoyaltyHoldFailedEvent = DomainEvent<LoyaltyHoldFailedPayload>;
export type MerchantLoyaltyOffsetAppliedEvent = DomainEvent<MerchantLoyaltyOffsetAppliedPayload>;
