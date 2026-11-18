import {
  ALL_PERMISSIONS,
  CUSTOMER_PERMISSIONS,
  type Permission,
  PLATFORM_ADMIN_PERMISSIONS,
  type PlatformRole,
  type TenantRole,
} from '@foodapp/db';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import { CompositeSpecification } from '@/core/patterns/specification';

export type ActorSource = 'GLOBAL_USER' | 'POS_STAFF' | 'SYSTEM';

export type RequestContext = {
  requestId: string;
  actorId: string;
  actorSource: ActorSource;
  restaurantId?: string;
  roleId?: string;
  globalRole?: PlatformRole;
  tenantRole?: TenantRole;
  permissions: readonly Permission[];
};

export function resolveDefaultPermissionsForActor(params: {
  actorSource: ActorSource;
  globalRole?: PlatformRole;
  resolvedTenantPermissions?: readonly Permission[];
}): readonly Permission[] {
  if (params.actorSource === 'SYSTEM') {
    return [
      ...ALL_PERMISSIONS,
    ];
  }

  if (params.actorSource === 'GLOBAL_USER') {
    if (params.globalRole === 'PLATFORM_ADMIN') {
      return [
        ...ALL_PERMISSIONS,
      ];
    }
    if (params.globalRole === 'CUSTOMER') {
      return [
        ...CUSTOMER_PERMISSIONS,
      ];
    }
    return [];
  }

  return params.resolvedTenantPermissions ?? [];
}

// GoF Pattern: Specification — Composable capability check
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
    if (request.actorSource === 'SYSTEM') return true;
    if (request.actorSource === 'GLOBAL_USER' && request.globalRole === 'PLATFORM_ADMIN') {
      return true;
    }
    return request.permissions.includes(permission);
  }
}

// GoF Pattern: Specification — Composable multi-tenant ownership check
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
    if (request.actorSource === 'SYSTEM') return true;
    if (request.actorSource === 'GLOBAL_USER' && request.globalRole === 'PLATFORM_ADMIN') {
      return true;
    }
    return request.actorSource === 'POS_STAFF' && request.restaurantId === targetRestaurantId;
  }
}

// GoF Pattern: Specification — Composable customer/user ownership check
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
    if (request.actorSource === 'SYSTEM') return true;
    if (request.actorSource === 'GLOBAL_USER' && request.globalRole === 'PLATFORM_ADMIN') {
      return true;
    }
    return request.actorSource === 'GLOBAL_USER' && request.actorId === targetUserId;
  }
}

// GoF Pattern: Strategy — Request-scoped authorization policy injected via DI
export class AuthorizationPolicy {
  private readonly request: RequestContext;
  private readonly hasPermissionSpec = new HasPermissionSpec();
  private readonly sameRestaurantSpec = new SameRestaurantSpec();
  private readonly sameUserSpec = new SameUserSpec();

  constructor(request: RequestContext) {
    this.request = request;
  }

  isPlatformAdmin(): boolean {
    return (
      this.request.actorSource === 'GLOBAL_USER' && this.request.globalRole === 'PLATFORM_ADMIN'
    );
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

  assertRestaurantAccess(
    targetRestaurantId: string,
    requiredPermission?: Permission,
  ): Result<void, DomainError> {
    const allowedTenant = this.sameRestaurantSpec.isSatisfiedBy({
      request: this.request,
      targetRestaurantId,
    });

    if (!allowedTenant) {
      return err(
        new DomainError('TENANT_FORBIDDEN', 'Access denied for target restaurant resource.', 403),
      );
    }

    if (requiredPermission) {
      return this.assertPermission(requiredPermission);
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

    if (requiredPermission) {
      return this.assertPermission(requiredPermission);
    }

    return ok(undefined);
  }

  static getPlatformAdminRights(): readonly Permission[] {
    return PLATFORM_ADMIN_PERMISSIONS;
  }
}
