// FILE: apps/backend/src/iam/domain/auth-actor.ts
import type { Permission, PlatformRole, TenantRole } from '@foodapp/db';

export type ActorSource = 'GLOBAL_USER' | 'POS_STAFF' | 'SYSTEM';

export interface StaffAssignedBranchDto {
  readonly branchId: string;
  readonly branchName: string;
  readonly branchKey: string;
  readonly city: string;
  readonly cityKey: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly isPrimary: boolean;
}

export interface PosStaffSessionClaims {
  readonly staffId: string;
  readonly restaurantId: string;
  readonly brandHandle: string;
  readonly activeBranchId: string;
  readonly activeBranchKey: string;
  readonly roleId: string;
  readonly role: TenantRole;
  readonly name: string;
  readonly email: string;
  readonly permissions: readonly Permission[];
  readonly assignedBranches: readonly StaffAssignedBranchDto[];
}

export interface GlobalUserSessionClaims {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: PlatformRole;
  readonly permissions: readonly Permission[];
}
