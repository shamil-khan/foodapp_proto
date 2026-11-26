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

  it('isolates PLATFORM_STAFF from customer and unapproved tenant operations', () => {
    const adminPerms = resolveDefaultPermissionsForActor({
      actorSource: 'PLATFORM_STAFF',
    });

    const policy = new AuthorizationPolicy({
      requestId: 'req-admin-1',
      actorId: 'admin-1',
      actorSource: 'PLATFORM_STAFF',
      permissions: adminPerms,
    });

    expect(policy.hasPermission('platform:restaurants:manage')).toBe(true);
    expect(policy.hasPermission('storefront:orders:place')).toBe(false);
    expect(policy.hasPermission('orders:place')).toBe(false);
    expect(policy.assertBranchAccess('branch-1', 'branch:status:manage').ok).toBe(false);
  });

  it('never leaks wildcard ALL_PERMISSIONS on ANONYMOUS defaults and strips non-tenant rights from POS tokens', async () => {
    const { Hono } = await import('hono');
    const { PosTokenService } = await import('@/iam/infrastructure/pos-token-service');
    const { sign } = await import('hono/jwt');

    const dbExports = await import('@foodapp/db');
    expect('ALL_PERMISSIONS' in dbExports).toBe(false);
    expect('SYSTEM_ACTORS' in dbExports).toBe(false);

    const anonymousDefaults = resolveDefaultPermissionsForActor({
      actorSource: 'ANONYMOUS',
    });
    expect(anonymousDefaults).toEqual([]);

    const forgedJwt = await sign(
      {
        staffId: 'staff-1',
        restaurantId: 'rest-1',
        brandHandle: 'pizza-hut',
        activeBranchId: 'branch-1',
        activeBranchKey: 'clifton',
        roleId: 'role-1',
        role: 'OWNER',
        name: 'Tom',
        email: 'tom@pizza-hut.com',
        permissions: [
          'orders:read',
          'platform:restaurants:manage',
          'storefront:orders:place',
          '*',
        ],
        assignedBranches: [],
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      process.env.BETTER_AUTH_SECRET ?? 'dev_pos_secret_change_in_prod',
      'HS256',
    );

    const svc = new PosTokenService();
    const testApp = new Hono();
    testApp.get('/check', async (c) => {
      const claims = await svc.verifyRequestToken(c);
      return c.json({
        permissions: claims?.permissions ?? [],
      });
    });

    const res = await testApp.request('/check', {
      headers: {
        Authorization: `Bearer ${forgedJwt}`,
      },
    });
    const body = (await res.json()) as {
      permissions: string[];
    };

    expect(body.permissions).toEqual([
      'orders:read',
    ]);
    expect(body.permissions).not.toContain('platform:restaurants:manage');
    expect(body.permissions).not.toContain('storefront:orders:place');
  });
});
