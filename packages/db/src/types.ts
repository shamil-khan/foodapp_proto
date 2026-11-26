export const ANONYMOUS_ACTOR_ID = '00000000-0000-4000-8a00-000000000000';
export const BOOTSTRAP_ACTOR_ID = '00000000-0000-4000-8b00-000000000000';
export const SEED_ACTOR_ID = '00000000-0000-4000-85ee-000000000001';

export type PlatformRole = 'PLATFORM_ADMIN' | 'CUSTOMER' | 'DRIVER';
export type TenantRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ORDER_TAKER';
export type PaymentPolicy = 'INSTANT_SPLIT' | 'CENTRAL_ESCROW' | 'CASH_FOCUS';
export type OrderSource = 'DINE_IN' | 'TAKEAWAY' | 'ONLINE_DELIVERY';
export type InStorePaymentMethod = 'CASH' | 'CARD_TERMINAL' | 'ONLINE_GATEWAY';
export type KdsRoutingTarget = 'KITCHEN_SCREEN' | 'BAR_PRINTER' | 'PASTRY_STATION';

export type KitchenType = 'RESTAURANT_BRANCH' | 'HOME_KITCHEN' | 'CLOUD_KITCHEN';
export type OperationalStatus = 'OPEN' | 'BUSY_PAUSED' | 'CLOSED' | 'HOLIDAY';
export type MenuPricingPolicyMode =
  | 'CENTRAL_LOCKED'
  | 'BRANCH_DIRECT'
  | 'BRANCH_APPROVAL_REQUIRED'
  | 'THRESHOLD_HYBRID';
export type MenuSelectionMode = 'ALL_BRAND_ITEMS' | 'SELECTED_ITEMS_ONLY';
export type HomePickupPrivacyMode = 'ORDER_ACCEPTANCE' | 'WHITELIST';
export type PriceApprovalStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type PermissionEffect = 'ALLOW' | 'DENY';
export type SupportTicketStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REVOKED' | 'EXPIRED';

export type OrderMilestone =
  | 'PLACED'
  | 'RESTAURANT_ACCEPTED'
  | 'FOOD_PREPARING'
  | 'SERVED'
  | 'READY_FOR_COLLECTION'
  | 'DRIVER_ASSIGNED'
  | 'EN_ROUTE'
  | 'DELIVERED'
  | 'CANCELLED';

export type PermissionDomainGroup =
  | 'BRAND_BRANCH'
  | 'CATALOG_PRICING'
  | 'POS_ORDERS'
  | 'LEDGER_TEAM';

export interface PermissionDefinition {
  readonly group: PermissionDomainGroup;
  readonly label: string;
  readonly description: string;
}

/**
 * SINGLE SOURCE OF TRUTH FOR TENANT RIGHTS:
 * Add or update any system right here—TypeScript union types, TENANT_PERMISSIONS,
 * TENANT_PERMISSION_CATALOG, and Zod enums derive automatically from this object.
 */
export const TENANT_PERMISSION_REGISTRY = {
  'brand:branches:create': {
    group: 'BRAND_BRANCH',
    label: 'Create Brand Branches',
    description: 'Create new physical branches or cloud hubs under the brand',
  },
  'brand:support:authorize': {
    group: 'BRAND_BRANCH',
    label: 'Authorize Platform Support Tickets',
    description: 'Create, approve, and revoke time-bound JIT support tickets for platform staff',
  },
  'branch:settings:manage': {
    group: 'BRAND_BRANCH',
    label: 'Manage Branch Settings',
    description: 'Edit branch schedule, contact details, fulfillment toggles, and privacy mode',
  },
  'branch:status:manage': {
    group: 'BRAND_BRANCH',
    label: 'Toggle Branch Status',
    description: 'Switch daily operational status (OPEN, BUSY_PAUSED, CLOSED, HOLIDAY)',
  },
  'branch:whitelist:manage': {
    group: 'BRAND_BRANCH',
    label: 'Manage Takeaway Whitelist',
    description: 'Approve or revoke customer walk-in takeaway requests for home kitchens',
  },
  'catalog:items:manage': {
    group: 'CATALOG_PRICING',
    label: 'Manage Catalog Items',
    description:
      'Create/edit brand or branch-local items, ingredient tags, and branch availability',
  },
  'catalog:price:update': {
    group: 'CATALOG_PRICING',
    label: 'Update or Propose Prices',
    description: 'Update item prices or submit branch price overrides per pricing policy',
  },
  'catalog:price:approve': {
    group: 'CATALOG_PRICING',
    label: 'Approve Branch Price Overrides',
    description: 'Approve or reject pending branch menu price override proposals',
  },
  'pricing:policy:manage': {
    group: 'CATALOG_PRICING',
    label: 'Configure Pricing Policy',
    description: 'Configure brand-wide or branch-level menu pricing and floor discount guardrails',
  },
  'orders:read': {
    group: 'POS_ORDERS',
    label: 'View Branch Orders',
    description: 'Read live POS and online orders for assigned branches',
  },
  'orders:place': {
    group: 'POS_ORDERS',
    label: 'Place POS Orders',
    description: 'Create in-store dine-in or takeaway POS orders',
  },
  'orders:settle': {
    group: 'POS_ORDERS',
    label: 'Settle POS Bills',
    description: 'Capture payment and settle open POS orders',
  },
  'orders:discount:apply': {
    group: 'POS_ORDERS',
    label: 'Apply Floor Discounts',
    description: 'Apply party/event order discounts within PricingPolicy percentage caps',
  },
  'orders:comp:waive': {
    group: 'POS_ORDERS',
    label: 'Issue 100% Comp Waive-Offs',
    description: 'Waive 100% of an order for celebrity/promotional guests with audit reason',
  },
  'orders:refund': {
    group: 'POS_ORDERS',
    label: 'Issue Order Refunds',
    description: 'Process order refunds within PricingPolicy monetary caps',
  },
  'ledger:read': {
    group: 'LEDGER_TEAM',
    label: 'View Financial Ledger',
    description: 'Inspect double-entry settlement and payout entries',
  },
  'staff:roles:manage': {
    group: 'LEDGER_TEAM',
    label: 'Manage Custom Roles',
    description: 'Create, update, and soft-delete custom roles within delegated rights',
  },
  'staff:manage': {
    group: 'LEDGER_TEAM',
    label: 'Manage Branch Staff & Rights',
    description: 'Assign roles and direct ALLOW/DENY permissions to staff within actor rights',
  },
} as const satisfies Record<string, PermissionDefinition>;
// --- FILE: packages/db/src/types.ts (Part 2 of 2) ---
export type TenantPermission = keyof typeof TENANT_PERMISSION_REGISTRY;

export const TENANT_PERMISSIONS = Object.keys(TENANT_PERMISSION_REGISTRY) as unknown as readonly [
  TenantPermission,
  ...TenantPermission[],
];

export interface TenantPermissionCatalogEntry extends PermissionDefinition {
  readonly key: TenantPermission;
}

export const TENANT_PERMISSION_CATALOG: readonly TenantPermissionCatalogEntry[] = (
  Object.keys(TENANT_PERMISSION_REGISTRY) as TenantPermission[]
).map((key) => ({
  key,
  ...TENANT_PERMISSION_REGISTRY[key],
}));

export const CUSTOMER_PERMISSIONS = [
  'storefront:orders:place',
  'storefront:orders:read',
  'loyalty:read',
  'loyalty:redeem',
] as const;

export const PLATFORM_SUPPORT_SCOPES = [
  'platform:support:branch-override',
  'platform:support:catalog-override',
  'platform:support:billing-settle',
  'platform:support:loyalty-governance',
] as const;

export const PLATFORM_ADMIN_PERMISSIONS = [
  'platform:restaurants:manage',
  'platform:loyalty:audit',
  ...PLATFORM_SUPPORT_SCOPES,
] as const;

export type CustomerPermission = (typeof CUSTOMER_PERMISSIONS)[number];
export type PlatformSupportScope = (typeof PLATFORM_SUPPORT_SCOPES)[number];
export type PlatformAdminPermission = (typeof PLATFORM_ADMIN_PERMISSIONS)[number];
export type Permission = TenantPermission | CustomerPermission | PlatformAdminPermission;

export interface SystemRoleDefinition {
  readonly description: string;
  readonly legacyTenantRole: TenantRole;
  readonly permissions: readonly TenantPermission[];
}

/**
 * SINGLE SOURCE OF TRUTH FOR PREDEFINED SYSTEM ROLES:
 * All roles defined here are seeded with `isSystemRole = true` (immutable via API).
 * Add or adjust predefined roles here without touching bootstrap or PBAC handlers.
 */
export const SYSTEM_ROLE_DEFINITIONS = {
  OWNER: {
    description: 'Full brand and single-location ownership with all rights',
    legacyTenantRole: 'OWNER',
    permissions: [
      ...TENANT_PERMISSIONS,
    ],
  },
  BRAND_OWNER: {
    description: 'Multi-branch brand owner with unrestricted brand & branch governance',
    legacyTenantRole: 'OWNER',
    permissions: [
      ...TENANT_PERMISSIONS,
    ],
  },
  OPERATIONAL_MANAGER: {
    description: 'Regional/multi-branch operational manager across assigned branches',
    legacyTenantRole: 'ADMIN',
    permissions: [
      'brand:branches:create',
      'brand:support:authorize',
      'branch:settings:manage',
      'branch:status:manage',
      'branch:whitelist:manage',
      'catalog:items:manage',
      'catalog:price:update',
      'catalog:price:approve',
      'orders:read',
      'orders:place',
      'orders:settle',
      'orders:discount:apply',
      'orders:comp:waive',
      'orders:refund',
      'ledger:read',
      'staff:roles:manage',
      'staff:manage',
    ],
  },
  BRANCH_MANAGER: {
    description: 'Branch manager handling daily floor operations, pricing proposals, and staff',
    legacyTenantRole: 'MANAGER',
    permissions: [
      'branch:settings:manage',
      'branch:status:manage',
      'branch:whitelist:manage',
      'catalog:items:manage',
      'catalog:price:update',
      'orders:read',
      'orders:place',
      'orders:settle',
      'orders:discount:apply',
      'orders:comp:waive',
      'orders:refund',
      'staff:roles:manage',
      'staff:manage',
    ],
  },
  SHIFT_SUPERVISOR: {
    description: 'Shift lead with order settlement, floor discounts, and status toggle rights',
    legacyTenantRole: 'MANAGER',
    permissions: [
      'branch:status:manage',
      'orders:read',
      'orders:place',
      'orders:settle',
      'orders:discount:apply',
    ],
  },
  CASHIER: {
    description: 'Front-of-house cashier for order taking and bill settlement',
    legacyTenantRole: 'ORDER_TAKER',
    permissions: [
      'orders:read',
      'orders:place',
      'orders:settle',
    ],
  },
  KITCHEN_STAFF: {
    description: 'Kitchen display and order fulfillment staff',
    legacyTenantRole: 'ORDER_TAKER',
    permissions: [
      'orders:read',
    ],
  },
  STAFF: {
    description: 'Lightweight helper role for home kitchens and small single-site teams',
    legacyTenantRole: 'ORDER_TAKER',
    permissions: [
      'branch:status:manage',
      'orders:read',
      'orders:place',
      'orders:settle',
    ],
  },
} as const satisfies Record<string, SystemRoleDefinition>;

export type SystemRoleName = keyof typeof SYSTEM_ROLE_DEFINITIONS;

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleName, readonly TenantPermission[]> =
  Object.fromEntries(
    (Object.keys(SYSTEM_ROLE_DEFINITIONS) as SystemRoleName[]).map((roleName) => [
      roleName,
      SYSTEM_ROLE_DEFINITIONS[roleName].permissions,
    ]),
  ) as unknown as Record<SystemRoleName, readonly TenantPermission[]>;

export const DEFAULT_ROLE_PERMISSIONS: Record<TenantRole, readonly TenantPermission[]> = {
  OWNER: SYSTEM_ROLE_DEFINITIONS.OWNER.permissions,
  ADMIN: SYSTEM_ROLE_DEFINITIONS.OPERATIONAL_MANAGER.permissions,
  MANAGER: SYSTEM_ROLE_DEFINITIONS.BRANCH_MANAGER.permissions,
  ORDER_TAKER: SYSTEM_ROLE_DEFINITIONS.CASHIER.permissions,
};

export interface AuditableEntity {
  rowVersion: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface Restaurant extends AuditableEntity {
  id: string;
  name: string;
  handle: string;
  logoUrl: string | null;
  description: string | null;
  vatNumber: string | null;
  companyHouseNumber: string | null;
  foodHygieneRating: number | null;
  postcodeSector: string;
  averagePrepTimeMinutes: number;
  payoutFrequency: string;
  isActiveOverride: boolean;
  platformFeeRate: string;
}
