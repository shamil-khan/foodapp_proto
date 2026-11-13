import type { PlatformRole, TenantRole } from '@foodapp/db';

export type ActorSource = 'GLOBAL_USER' | 'POS_STAFF' | 'SYSTEM';

export interface PosStaffSessionClaims {
  readonly staffId: string;
  readonly restaurantId: string;
  readonly role: TenantRole;
  readonly name: string;
  readonly email: string;
}

export interface GlobalUserSessionClaims {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: PlatformRole;
}
