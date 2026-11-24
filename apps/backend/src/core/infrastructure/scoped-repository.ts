import type { RequestContext } from '@/core/application/authorization';
import { DomainError } from '@/core/domain/result';

export class ForbiddenTenantScopeError extends DomainError {
  constructor(message: string) {
    super('TENANT_SCOPE_VIOLATION', message, 403);
    this.name = 'ForbiddenTenantScopeError';
  }
}

export interface TenantScopeFilter {
  readonly unrestricted: boolean;
  readonly restaurantId?: string;
  readonly branchId?: string;
  readonly userId?: string;
}

/**
 * Mandatory tenant/branch scope resolver used by domain repositories to guarantee
 * every query binds the active actor's tenant, branch, or customer boundary.
 */
export class ScopedRepository {
  protected readonly request: RequestContext;

  constructor(request: RequestContext) {
    this.request = request;
  }

  protected resolveBranchScope(requestedBranchId?: string): TenantScopeFilter {
    if (this.request.actorSource === 'SYSTEM') {
      return {
        unrestricted: true,
        branchId: requestedBranchId,
      };
    }
    if (
      this.request.actorSource === 'GLOBAL_USER' &&
      this.request.globalRole === 'PLATFORM_ADMIN'
    ) {
      return {
        unrestricted: true,
        branchId: requestedBranchId,
      };
    }
    if (this.request.actorSource === 'POS_STAFF') {
      if (!this.request.branchId || !this.request.restaurantId) {
        throw new ForbiddenTenantScopeError('POS staff context lacks active branch scope.');
      }
      if (requestedBranchId && requestedBranchId !== this.request.branchId) {
        throw new ForbiddenTenantScopeError(
          `Cross-branch access denied: active branch is ${this.request.branchId}.`,
        );
      }
      return {
        unrestricted: false,
        restaurantId: this.request.restaurantId,
        branchId: this.request.branchId,
      };
    }
    throw new ForbiddenTenantScopeError(
      'Branch-scoped repository access requires POS staff or admin.',
    );
  }

  protected resolveRestaurantScope(requestedRestaurantId?: string): TenantScopeFilter {
    if (this.request.actorSource === 'SYSTEM') {
      return {
        unrestricted: true,
        restaurantId: requestedRestaurantId,
      };
    }
    if (
      this.request.actorSource === 'GLOBAL_USER' &&
      this.request.globalRole === 'PLATFORM_ADMIN'
    ) {
      return {
        unrestricted: true,
        restaurantId: requestedRestaurantId,
      };
    }
    if (this.request.actorSource === 'POS_STAFF') {
      if (!this.request.restaurantId) {
        throw new ForbiddenTenantScopeError('POS staff context lacks brand scope.');
      }
      if (requestedRestaurantId && requestedRestaurantId !== this.request.restaurantId) {
        throw new ForbiddenTenantScopeError('Cross-brand access denied.');
      }
      return {
        unrestricted: false,
        restaurantId: this.request.restaurantId,
      };
    }
    throw new ForbiddenTenantScopeError('Brand-scoped repository access denied.');
  }

  protected resolveUserScope(targetUserId: string): TenantScopeFilter {
    if (this.request.actorSource === 'SYSTEM') {
      return {
        unrestricted: true,
        userId: targetUserId,
      };
    }
    if (
      this.request.actorSource === 'GLOBAL_USER' &&
      this.request.globalRole === 'PLATFORM_ADMIN'
    ) {
      return {
        unrestricted: true,
        userId: targetUserId,
      };
    }
    if (this.request.actorSource === 'GLOBAL_USER' && this.request.actorId === targetUserId) {
      return {
        unrestricted: false,
        userId: targetUserId,
      };
    }
    throw new ForbiddenTenantScopeError('Cross-user access denied.');
  }
}
