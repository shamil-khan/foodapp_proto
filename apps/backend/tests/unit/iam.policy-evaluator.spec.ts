// FILE: apps/backend/tests/unit/iam.policy-evaluator.spec.ts
import { describe, expect, it } from 'vitest';
import {
  AuthorizationPolicy,
  resolveDefaultPermissionsForActor,
} from '@/core/application/authorization';
import { evaluateEffectivePermissions } from '@/iam/domain/permission-evaluator';

describe('iam.policy-evaluator — Role + Direct ALLOW/DENY Precedence & Actor Isolation', () => {
  it('allows direct ALLOW grants and enforces explicit DENY precedence over role permissions', () => {
    const now = new Date('2026-11-24T12:00:00.000Z');
    const effective = evaluateEffectivePermissions({
      rolePermissions: [
        'orders:read',
        'orders:place',
        'orders:settle',
        'orders:refund',
      ],
      directRules: [
        {
          permission: 'orders:discount:apply',
          effect: 'ALLOW',
          validFrom: '2026-11-24T10:00:00.000Z',
          expiresAt: '2026-11-24T18:00:00.000Z',
        },
        {
          permission: 'orders:refund',
          effect: 'DENY',
          validFrom: null,
          expiresAt: null,
        },
        {
          permission: 'orders:comp:waive',
          effect: 'ALLOW',
          validFrom: '2026-11-24T10:00:00.000Z',
          expiresAt: '2026-11-24T11:30:00.000Z', // expired
        },
      ],
      now,
    });

    expect(effective).toContain('orders:read');
    expect(effective).toContain('orders:discount:apply');
    expect(effective).not.toContain('orders:refund');
    expect(effective).not.toContain('orders:comp:waive');
  });

  it('isolates PLATFORM_ADMIN from customer and unapproved tenant operations', () => {
    const adminPerms = resolveDefaultPermissionsForActor({
      actorSource: 'GLOBAL_USER',
      globalRole: 'PLATFORM_ADMIN',
    });

    const policy = new AuthorizationPolicy({
      requestId: 'req-admin-1',
      actorId: 'admin-1',
      actorSource: 'GLOBAL_USER',
      globalRole: 'PLATFORM_ADMIN',
      permissions: adminPerms,
    });

    expect(policy.hasPermission('platform:restaurants:manage')).toBe(true);
    expect(policy.hasPermission('storefront:orders:place')).toBe(false);
    expect(policy.hasPermission('orders:place')).toBe(false);
    expect(policy.assertBranchAccess('branch-1', 'branch:status:manage').ok).toBe(false);
  });
});
