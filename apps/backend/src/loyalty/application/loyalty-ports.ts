import type Decimal from 'decimal.js';
import type { Result } from '@/core/domain/result';
import type { LoyaltyIssuerScope } from '@/loyalty/domain/loyalty-events';

export interface ClockPort {
  now(): Date;
}

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}

export interface HoldCheckoutPointsInput {
  readonly userId: string;
  readonly restaurantId: string;
  readonly orderId: string;
  readonly issuerScope: LoyaltyIssuerScope;
  readonly pointsToHold: number;
  readonly allowLoyaltyRedeem: boolean;
}

export interface HeldPointsQuote {
  readonly pointsHeld: number;
  readonly discountGbp: Decimal;
  readonly issuerScope: LoyaltyIssuerScope;
}

/**
 * Hexagonal port exposed by `loyalty` to `orders` and `billing` so cross-context
 * holds, settlement commits, and B2B merchant fee offsets never touch raw tables.
 */
export interface LoyaltySettlementPort {
  holdCheckoutPoints(
    input: HoldCheckoutPointsInput,
    actorId: string,
  ): Promise<Result<HeldPointsQuote>>;
  releaseCheckoutHold(
    orderId: string,
    userId: string,
    reason: string,
    actorId: string,
  ): Promise<void>;
  settleOrderLoyalty(params: {
    readonly orderId: string;
    readonly userId: string;
    readonly restaurantId: string;
    readonly netFoodSubtotalGbp: Decimal;
    readonly allowLoyaltyEarn: boolean;
    readonly actorId: string;
  }): Promise<void>;
  redeemMerchantPointsForFeeOffset(params: {
    readonly restaurantId: string;
    readonly settlementId: string;
    readonly maxOffsetGbp: Decimal;
    readonly actorId: string;
  }): Promise<{
    readonly pointsRedeemed: number;
    readonly offsetGbp: Decimal;
  }>;
}
