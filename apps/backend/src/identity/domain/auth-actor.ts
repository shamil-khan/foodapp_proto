import type { Permission, PlatformRole, TenantRole } from '@foodapp/db';

export type ActorSource = 'GLOBAL_USER' | 'POS_STAFF' | 'SYSTEM';

export interface PosStaffSessionClaims {
  readonly staffId: string;
  readonly restaurantId: string;
  readonly subdomain: string;
  readonly roleId: string;
  readonly role: TenantRole;
  readonly name: string;
  readonly email: string;
  readonly permissions: readonly Permission[];
}

export interface GlobalUserSessionClaims {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: PlatformRole;
  readonly permissions: readonly Permission[];
}
