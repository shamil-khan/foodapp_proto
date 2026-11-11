export const SYSTEM_ACTORS = {
  /** 5EE0 = SEED (Initial database seed script) */
  SEED_SCRIPT: '00000000-0000-0000-5ee0-000000000001',
  /** 5150 = SYS (Automated background cron & scheduled tasks) */
  SYSTEM_CRON: '00000000-0000-0000-5150-000000000001',
  /** B070 = BOT (Hardware POS & KDS printer webhooks) */
  POS_WEBHOOK_BOT: '00000000-0000-0000-b070-000000000001',
  /** A017 = AUDIT (Migration & schema backfill guard) */
  MIGRATION_GUARD: '00000000-0000-0000-a017-000000000001',
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
  vatNumber: string | null;
  companyHouseNumber: string | null;
  foodHygieneRating: number;
  postcodeSector: string;
  averagePrepTimeMinutes: number;
  payoutFrequency: string;
  isActiveOverride: boolean;
  platformFeeRate: string;
}
