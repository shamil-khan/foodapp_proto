import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@/core/application/authorization';
import { ScopedRepository } from '@/core/infrastructure/scoped-repository';

class TestTenantRepo extends ScopedRepository {
  requireTenant(requestedRestaurantId?: string): string | undefined {
    return this.resolveRestaurantScope(requestedRestaurantId).restaurantId;
  }

  requireBranch(branchId: string): void {
    this.resolveBranchScope(branchId);
  }
}

describe('shared.scoped-repository — Mandatory Tenant & Branch Isolation', () => {
  it('permits matching restaurant and assigned branch access for POS_STAFF', () => {
    const ctx: RequestContext = {
      requestId: 'req-1',
      actorId: 'staff-1',
      actorSource: 'POS_STAFF',
      restaurantId: 'rest-A',
      branchId: 'branch-A1',
      permissions: [
        'orders:read',
      ],
    };
    const repo = new TestTenantRepo(ctx);

    expect(repo.requireTenant('rest-A')).toBe('rest-A');
    expect(() => repo.requireBranch('branch-A1')).not.toThrow();
  });

  it('throws TENANT_SCOPE_VIOLATION when context is ANONYMOUS or crosses branch boundaries', () => {
    const unauthCtx: RequestContext = {
      requestId: 'req-2',
      actorId: '00000000-0000-4000-8a00-000000000000',
      actorSource: 'ANONYMOUS',
      permissions: [],
    };
    const unauthRepo = new TestTenantRepo(unauthCtx);
    expect(() => unauthRepo.requireTenant('rest-A')).toThrow(/brand-scoped repository access/i);

    const staffCtx: RequestContext = {
      requestId: 'req-3',
      actorId: 'staff-1',
      actorSource: 'POS_STAFF',
      restaurantId: 'rest-A',
      branchId: 'branch-A1',
      permissions: [
        'orders:read',
      ],
    };
    const staffRepo = new TestTenantRepo(staffCtx);
    expect(() => staffRepo.requireBranch('branch-B9')).toThrow(/cross-branch access denied/i);
  });
});
