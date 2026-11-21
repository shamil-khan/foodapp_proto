import type { MenuPricingPolicyMode, PriceApprovalStatus } from '@foodapp/db';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export interface PricingPolicyConfig {
  readonly menuPricingMode: MenuPricingPolicyMode;
  readonly maxDirectPriceDeltaPercent: number;
  readonly allowBranchLocalItems: boolean;
  readonly maxDirectOrderDiscountPercent: number;
  readonly allowFullCompWaiveOff: boolean;
  readonly requireReasonForCompOrDiscount: boolean;
  readonly maxDirectRefundAmount: number;
}

export interface PriceOverrideDecision {
  readonly approvalStatus: PriceApprovalStatus;
  readonly priceOverride: number | null;
  readonly pendingPriceOverride: number | null;
}

/**
 * GoF Strategy Pattern: Encapsulates brand/branch menu pricing governance rules.
 */
export interface MenuPricingWorkflowStrategy {
  evaluatePriceProposal(params: {
    basePrice: number;
    proposedPrice: number;
    policy: PricingPolicyConfig;
    canApproveDirectly: boolean;
  }): Result<PriceOverrideDecision, DomainError>;
}

class CentralLockedPricingStrategy implements MenuPricingWorkflowStrategy {
  evaluatePriceProposal(params: {
    proposedPrice: number;
    canApproveDirectly: boolean;
  }): Result<PriceOverrideDecision, DomainError> {
    if (!params.canApproveDirectly) {
      return err(
        new DomainError(
          'PRICING_LOCKED',
          'Brand pricing policy is CENTRAL_LOCKED; branch price overrides are not permitted.',
          403,
        ),
      );
    }
    return ok({
      approvalStatus: 'APPROVED',
      priceOverride: Number(params.proposedPrice.toFixed(2)),
      pendingPriceOverride: null,
    });
  }
}

class BranchDirectPricingStrategy implements MenuPricingWorkflowStrategy {
  evaluatePriceProposal(params: {
    proposedPrice: number;
  }): Result<PriceOverrideDecision, DomainError> {
    return ok({
      approvalStatus: 'APPROVED',
      priceOverride: Number(params.proposedPrice.toFixed(2)),
      pendingPriceOverride: null,
    });
  }
}

class BranchApprovalRequiredPricingStrategy implements MenuPricingWorkflowStrategy {
  evaluatePriceProposal(params: {
    proposedPrice: number;
    canApproveDirectly: boolean;
  }): Result<PriceOverrideDecision, DomainError> {
    const cleanPrice = Number(params.proposedPrice.toFixed(2));
    if (params.canApproveDirectly) {
      return ok({
        approvalStatus: 'APPROVED',
        priceOverride: cleanPrice,
        pendingPriceOverride: null,
      });
    }
    return ok({
      approvalStatus: 'PENDING',
      priceOverride: null,
      pendingPriceOverride: cleanPrice,
    });
  }
}

class ThresholdHybridPricingStrategy implements MenuPricingWorkflowStrategy {
  evaluatePriceProposal(params: {
    basePrice: number;
    proposedPrice: number;
    policy: PricingPolicyConfig;
    canApproveDirectly: boolean;
  }): Result<PriceOverrideDecision, DomainError> {
    const cleanPrice = Number(params.proposedPrice.toFixed(2));
    if (params.canApproveDirectly || params.basePrice <= 0) {
      return ok({
        approvalStatus: 'APPROVED',
        priceOverride: cleanPrice,
        pendingPriceOverride: null,
      });
    }
    const deltaPercent = Math.abs((cleanPrice - params.basePrice) / params.basePrice) * 100;
    if (deltaPercent <= params.policy.maxDirectPriceDeltaPercent) {
      return ok({
        approvalStatus: 'APPROVED',
        priceOverride: cleanPrice,
        pendingPriceOverride: null,
      });
    }
    return ok({
      approvalStatus: 'PENDING',
      priceOverride: null,
      pendingPriceOverride: cleanPrice,
    });
  }
}

export function resolveMenuPricingStrategy(
  mode: MenuPricingPolicyMode,
): MenuPricingWorkflowStrategy {
  switch (mode) {
    case 'CENTRAL_LOCKED':
      return new CentralLockedPricingStrategy();
    case 'BRANCH_DIRECT':
      return new BranchDirectPricingStrategy();
    case 'BRANCH_APPROVAL_REQUIRED':
      return new BranchApprovalRequiredPricingStrategy();
    case 'THRESHOLD_HYBRID':
      return new ThresholdHybridPricingStrategy();
  }
}
