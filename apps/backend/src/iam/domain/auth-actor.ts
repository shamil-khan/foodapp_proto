import type { Permission, TenantRole } from '@foodapp/db';

export type ActorSource = 'ANONYMOUS' | 'CUSTOMER' | 'POS_STAFF' | 'PLATFORM_STAFF';

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

export interface CustomerSessionClaims {
  readonly customerId: string;
  readonly phoneNumber: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

export interface PlatformStaffSessionClaims {
  readonly platformStaffId: string;
  readonly email: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}
