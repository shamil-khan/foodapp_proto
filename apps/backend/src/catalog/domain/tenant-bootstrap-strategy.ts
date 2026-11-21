import type { KitchenType, SystemRoleName } from '@foodapp/db';

export interface FulfillmentDefaults {
  readonly supportsDineIn: boolean;
  readonly supportsTakeaway: boolean;
  readonly supportsPlatformDelivery: boolean;
}

export interface TenantBootstrapPlan {
  readonly onboardingProfile: 'SIMPLE_SINGLE_SITE' | 'MULTI_BRANCH_ENTERPRISE';
  readonly rolesToSeed: readonly SystemRoleName[];
  readonly ownerRoleName: SystemRoleName;
  readonly fulfillmentDefaults: FulfillmentDefaults;
}

/**
 * GoF Strategy Pattern: Tailors onboarding roles & fulfillment defaults by seller archetype.
 */
export function resolveTenantBootstrapPlan(params: {
  kitchenType: KitchenType;
  isMultiBranchEnterprise?: boolean;
}): TenantBootstrapPlan {
  const fulfillmentDefaults: FulfillmentDefaults =
    params.kitchenType === 'HOME_KITCHEN'
      ? {
          supportsDineIn: false,
          supportsTakeaway: false,
          supportsPlatformDelivery: true,
        }
      : params.kitchenType === 'CLOUD_KITCHEN'
        ? {
            supportsDineIn: false,
            supportsTakeaway: true,
            supportsPlatformDelivery: true,
          }
        : {
            supportsDineIn: true,
            supportsTakeaway: true,
            supportsPlatformDelivery: true,
          };

  if (params.isMultiBranchEnterprise) {
    return {
      onboardingProfile: 'MULTI_BRANCH_ENTERPRISE',
      rolesToSeed: [
        'BRAND_OWNER',
        'OPERATIONAL_MANAGER',
        'BRANCH_MANAGER',
        'SHIFT_SUPERVISOR',
        'CASHIER',
        'KITCHEN_STAFF',
      ],
      ownerRoleName: 'BRAND_OWNER',
      fulfillmentDefaults,
    };
  }

  return {
    onboardingProfile: 'SIMPLE_SINGLE_SITE',
    rolesToSeed: [
      'OWNER',
      'STAFF',
    ],
    ownerRoleName: 'OWNER',
    fulfillmentDefaults,
  };
}
