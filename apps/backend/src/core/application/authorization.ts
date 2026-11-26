import {
  CUSTOMER_PERMISSIONS,
  type Permission,
  PLATFORM_ADMIN_PERMISSIONS,
  type PlatformSupportScope,
  type TenantRole,
} from '@foodapp/db';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import { CompositeSpecification } from '@/core/patterns/specification';

export type ActorSource = 'ANONYMOUS' | 'CUSTOMER' | 'POS_STAFF' | 'PLATFORM_STAFF';

export interface ActiveSupportGrant {
  readonly ticketId: string;
  readonly restaurantId: string;
  readonly branchId?: string;
  readonly scopePermission: PlatformSupportScope;
  readonly expiresAt: string;
}

export type RequestContext = {
  requestId: string;
  actorId: string;
  actorSource: ActorSource;
  restaurantId?: string;
  branchId?: string;
  roleId?: string;
  tenantRole?: TenantRole;
  permissions: readonly Permission[];
  supportGrant?: ActiveSupportGrant;
};

export function resolveDefaultPermissionsForActor(params: {
  actorSource: ActorSource;
  resolvedTenantPermissions?: readonly Permission[];
}): readonly Permission[] {
  if (params.actorSource === 'ANONYMOUS') {
    return [];
  }

  if (params.actorSource === 'PLATFORM_STAFF') {
    return [
      ...PLATFORM_ADMIN_PERMISSIONS,
    ];
  }

  if (params.actorSource === 'CUSTOMER') {
    return [
      ...CUSTOMER_PERMISSIONS,
    ];
  }

  return params.resolvedTenantPermissions ?? [];
}

/**
 * Specification checking whether the current actor possesses a specific permission.
 */
export class HasPermissionSpec extends CompositeSpecification<{
  request: RequestContext;
  permission: Permission;
}> {
  isSatisfiedBy({
    request,
    permission,
  }: {
    request: RequestContext;
    permission: Permission;
  }): boolean {
    if (request.actorSource === 'ANONYMOUS') return false;
    return request.permissions.includes(permission);
  }
}

/**
 * Specification enforcing multi-tenant brand isolation across all repository and handler layers.
 */
export class SameRestaurantSpec extends CompositeSpecification<{
  request: RequestContext;
  targetRestaurantId: string;
}> {
  isSatisfiedBy({
    request,
    targetRestaurantId,
  }: {
    request: RequestContext;
    targetRestaurantId: string;
  }): boolean {
    // Platform staff can access tenant resources only via an approved JIT support ticket
    if (
      request.actorSource === 'PLATFORM_STAFF' &&
      request.supportGrant?.restaurantId === targetRestaurantId
    ) {
      return true;
    }
    return request.actorSource === 'POS_STAFF' && request.restaurantId === targetRestaurantId;
  }
}

export class SameBranchSpec extends CompositeSpecification<{
  request: RequestContext;
  targetBranchId: string;
}> {
  isSatisfiedBy({
    request,
    targetBranchId,
  }: {
    request: RequestContext;
    targetBranchId: string;
  }): boolean {
    if (
      request.actorSource === 'PLATFORM_STAFF' &&
      request.supportGrant &&
      (!request.supportGrant.branchId || request.supportGrant.branchId === targetBranchId)
    ) {
      return true;
    }
    return request.actorSource === 'POS_STAFF' && request.branchId === targetBranchId;
  }
}

export class SameUserSpec extends CompositeSpecification<{
  request: RequestContext;
  targetUserId: string;
}> {
  isSatisfiedBy({
    request,
    targetUserId,
  }: {
    request: RequestContext;
    targetUserId: string;
  }): boolean {
    // Business logins (POS_STAFF / PLATFORM_STAFF) never act as consumer wallet owners
    return request.actorSource === 'CUSTOMER' && request.actorId === targetUserId;
  }
}

export class CanDelegatePermissionsSpec extends CompositeSpecification<{
  request: RequestContext;
  targetPermissions: readonly Permission[];
}> {
  isSatisfiedBy({
    request,
    targetPermissions,
  }: {
    request: RequestContext;
    targetPermissions: readonly Permission[];
  }): boolean {
    if (request.actorSource === 'ANONYMOUS') return false;
    const held = new Set<Permission>(request.permissions);
    return targetPermissions.every((perm) => held.has(perm));
  }
}

export class AuthorizationPolicy {
  private readonly request: RequestContext;
  private readonly hasPermissionSpec = new HasPermissionSpec();
  private readonly sameRestaurantSpec = new SameRestaurantSpec();
  private readonly sameBranchSpec = new SameBranchSpec();
  private readonly sameUserSpec = new SameUserSpec();
  private readonly canDelegateSpec = new CanDelegatePermissionsSpec();

  constructor(request: RequestContext) {
    this.request = request;
  }

  isPlatformAdmin(): boolean {
    return this.request.actorSource === 'PLATFORM_STAFF';
  }

  hasSupportGrant(scope: PlatformSupportScope, targetRestaurantId?: string): boolean {
    if (!this.isPlatformAdmin() || !this.request.supportGrant) return false;
    if (this.request.supportGrant.scopePermission !== scope) return false;
    if (targetRestaurantId && this.request.supportGrant.restaurantId !== targetRestaurantId) {
      return false;
    }
    return new Date(this.request.supportGrant.expiresAt) > new Date();
  }

  hasPermission(permission: Permission): boolean {
    return this.hasPermissionSpec.isSatisfiedBy({
      request: this.request,
      permission,
    });
  }

  assertPermission(permission: Permission): Result<void, DomainError> {
    if (!this.hasPermission(permission)) {
      return err(
        new DomainError('INSUFFICIENT_RIGHTS', `Missing required right: ${permission}`, 403),
      );
    }
    return ok(undefined);
  }

  assertAnyPermission(permissions: readonly Permission[]): Result<void, DomainError> {
    if (permissions.some((perm) => this.hasPermission(perm))) {
      return ok(undefined);
    }
    return err(
      new DomainError(
        'INSUFFICIENT_RIGHTS',
        `Missing any required right: ${permissions.join(', ')}`,
        403,
      ),
    );
  }

  assertRestaurantAccess(
    targetRestaurantId: string,
    requiredPermission?: Permission,
    supportScope?: PlatformSupportScope,
  ): Result<void, DomainError> {
    if (supportScope && this.hasSupportGrant(supportScope, targetRestaurantId)) {
      return this.assertPermission(supportScope);
    }

    const allowedTenant = this.sameRestaurantSpec.isSatisfiedBy({
      request: this.request,
      targetRestaurantId,
    });
    if (!allowedTenant) {
      return err(
        new DomainError('TENANT_FORBIDDEN', 'Access denied for target brand resource.', 403),
      );
    }
    return requiredPermission ? this.assertPermission(requiredPermission) : ok(undefined);
  }

  assertBranchAccess(
    targetBranchId: string,
    requiredPermission?: Permission,
    supportScope?: PlatformSupportScope,
  ): Result<void, DomainError> {
    if (
      supportScope &&
      this.hasSupportGrant(supportScope) &&
      this.sameBranchSpec.isSatisfiedBy({
        request: this.request,
        targetBranchId,
      })
    ) {
      return this.assertPermission(supportScope);
    }

    const allowedBranch = this.sameBranchSpec.isSatisfiedBy({
      request: this.request,
      targetBranchId,
    });
    if (!allowedBranch) {
      return err(
        new DomainError(
          'BRANCH_FORBIDDEN',
          'Access denied for target branch. Switch active branch first.',
          403,
        ),
      );
    }
    return requiredPermission ? this.assertPermission(requiredPermission) : ok(undefined);
  }

  assertCanDelegate(targetPermissions: readonly Permission[]): Result<void, DomainError> {
    if (
      !this.canDelegateSpec.isSatisfiedBy({
        request: this.request,
        targetPermissions,
      })
    ) {
      return err(
        new DomainError(
          'PRIVILEGE_ESCALATION_DENIED',
          'Cannot grant permissions that you do not personally hold.',
          403,
        ),
      );
    }
    return ok(undefined);
  }

  assertUserAccess(
    targetUserId: string,
    requiredPermission?: Permission,
  ): Result<void, DomainError> {
    const allowedUser = this.sameUserSpec.isSatisfiedBy({
      request: this.request,
      targetUserId,
    });
    if (!allowedUser) {
      return err(new DomainError('USER_FORBIDDEN', 'Access denied for target user resource.', 403));
    }
    return requiredPermission ? this.assertPermission(requiredPermission) : ok(undefined);
  }

  static getPlatformAdminRights(): readonly Permission[] {
    return PLATFORM_ADMIN_PERMISSIONS;
  }
}
