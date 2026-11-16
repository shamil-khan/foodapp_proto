export const SYSTEM_ACTORS = {
  /** 85EE = SEED (Initial database seed script) */
  SEED_SCRIPT: '00000000-0000-4000-85ee-000000000001',
  /** 8515 = SYS (Automated background cron & scheduled tasks) */
  SYSTEM_CRON: '00000000-0000-4000-8515-000000000001',
  /** 8B07 = BOT (Hardware POS & KDS printer webhooks) */
  POS_WEBHOOK_BOT: '00000000-0000-4000-8b07-000000000001',
  /** 8A01 = AUDIT (Migration & schema backfill guard) */
  MIGRATION_GUARD: '00000000-0000-4000-8a01-000000000001',
} as const;

export type SystemActorId = (typeof SYSTEM_ACTORS)[keyof typeof SYSTEM_ACTORS];

export type PlatformRole = 'PLATFORM_ADMIN' | 'CUSTOMER' | 'DRIVER';
export type TenantRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ORDER_TAKER';
export type PaymentPolicy = 'INSTANT_SPLIT' | 'CENTRAL_ESCROW' | 'CASH_FOCUS';
export type OrderSource = 'DINE_IN' | 'TAKEAWAY' | 'ONLINE_DELIVERY';
export type InStorePaymentMethod = 'CASH' | 'CARD_TERMINAL' | 'ONLINE_GATEWAY';
export type KdsRoutingTarget = 'KITCHEN_SCREEN' | 'BAR_PRINTER' | 'PASTRY_STATION';
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

export const TENANT_PERMISSIONS = [
  'catalog:price:update',
  'orders:read',
  'orders:place',
  'orders:settle',
  'ledger:read',
  'staff:roles:manage',
  'staff:manage',
] as const;

export const CUSTOMER_PERMISSIONS = [
  'storefront:orders:place',
  'storefront:orders:read',
  'loyalty:read',
  'loyalty:redeem',
] as const;

export const PLATFORM_ADMIN_PERMISSIONS = [
  'platform:restaurants:manage',
  'platform:tenants:support',
] as const;

export const ALL_PERMISSIONS = [
  ...TENANT_PERMISSIONS,
  ...CUSTOMER_PERMISSIONS,
  ...PLATFORM_ADMIN_PERMISSIONS,
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];
export type CustomerPermission = (typeof CUSTOMER_PERMISSIONS)[number];
export type PlatformAdminPermission = (typeof PLATFORM_ADMIN_PERMISSIONS)[number];
export type Permission = (typeof ALL_PERMISSIONS)[number];

export const DEFAULT_ROLE_PERMISSIONS: Record<TenantRole, readonly TenantPermission[]> = {
  OWNER: [
    ...TENANT_PERMISSIONS,
  ],
  ADMIN: [
    'catalog:price:update',
    'orders:read',
    'orders:place',
    'orders:settle',
    'ledger:read',
    'staff:roles:manage',
    'staff:manage',
  ],
  MANAGER: [
    'catalog:price:update',
    'orders:read',
    'orders:place',
    'orders:settle',
  ],
  ORDER_TAKER: [
    'orders:read',
    'orders:place',
  ],
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
  subdomain: string;
  vatNumber: string | null;
  companyHouseNumber: string | null;
  foodHygieneRating: number;
  postcodeSector: string;
  averagePrepTimeMinutes: number;
  payoutFrequency: string;
  isActiveOverride: boolean;
  platformFeeRate: string;
}
