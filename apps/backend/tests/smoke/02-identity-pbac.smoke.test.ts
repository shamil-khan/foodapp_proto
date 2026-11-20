import { beforeAll, describe, expect, it } from 'vitest';
import { ApiTestClient, loginPosStaff } from '../helpers/api-client.js';

interface RoleSummary {
  id: string;
  name: string;
  isSystemRole: boolean;
}

describe('02 — Identity, Subdomain Login, Dynamic PBAC & Admin Guard', () => {
  const client = new ApiTestClient();
  let ownerToken = '';
  let takerToken = '';
  let takerStaffId = '';
  let customRoleId = '';

  beforeAll(async () => {
    ownerToken = await loginPosStaff(client, {
      subdomain: 'westminster-patty',
      email: 'staff1.0002@pos-tenant.co.uk',
      password: 'Password123!',
    });

    takerToken = await loginPosStaff(client, {
      subdomain: 'westminster-patty',
      email: 'staff5.0002@pos-tenant.co.uk',
      password: 'Password123!',
    });

    const takerMe = await client.get<{
      actor: {
        id: string;
      };
    }>('/api/me', {
      token: takerToken,
    });
    takerStaffId = takerMe.body.actor.id;
  });

  it('2.1–2.2 Validates POS login errors (400 / 401) and inspects GET /api/me (401 / 200)', async () => {
    const unauth = await client.get('/api/me');
    expect(unauth.status).toBe(401);

    const badPayload = await client.post<{
      code: string;
    }>('/api/pos/auth/login', {
      subdomain: 'westminster-patty',
      email: 'invalid-email',
      password: '',
    });
    expect(badPayload.status).toBe(400);
    expect(badPayload.body.code).toBe('VALIDATION_ERROR');

    const crossSubdomain = await client.post<{
      code: string;
    }>('/api/pos/auth/login', {
      subdomain: 'smash360',
      email: 'staff1.0002@pos-tenant.co.uk',
      password: 'Password123!',
    });
    expect(crossSubdomain.status).toBe(401);
    expect(crossSubdomain.body.code).toBe('INVALID_CREDENTIALS');

    const me = await client.get<{
      actor: {
        source: string;
        role: string;
        permissions: string[];
      };
    }>('/api/me', {
      token: ownerToken,
    });
    expect(me.status).toBe(200);
    expect(me.body.actor.source).toBe('POS_STAFF');
    expect(me.body.actor.role).toBe('OWNER');
    expect(me.body.actor.permissions).toHaveLength(7);
  });

  it('2.3–2.4 Lists 7 tenant rights, creates custom role (201), rejects duplicate (409), and updates (200)', async () => {
    const rights = await client.get<{
      rights: string[];
    }>('/api/pos/roles/rights', {
      token: ownerToken,
    });
    expect(rights.status).toBe(200);
    expect(rights.body.rights).toHaveLength(7);

    const created = await client.post<{
      roleId: string;
    }>(
      '/api/pos/roles',
      {
        name: 'SHIFT_LEAD',
        description: 'Can place & settle orders',
        permissions: [
          'orders:read',
          'orders:place',
          'orders:settle',
        ],
      },
      {
        token: ownerToken,
      },
    );
    expect(created.status).toBe(201);
    customRoleId = created.body.roleId;

    const dup = await client.post<{
      code: string;
    }>(
      '/api/pos/roles',
      {
        name: 'SHIFT_LEAD',
        permissions: [
          'orders:read',
        ],
      },
      {
        token: ownerToken,
      },
    );
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('ROLE_EXISTS');

    const updated = await client.patch(
      `/api/pos/roles/${customRoleId}`,
      {
        description: 'Read-only orders',
        permissions: [
          'orders:read',
        ],
      },
      {
        token: ownerToken,
      },
    );
    expect(updated.status).toBe(200);
  });

  it('2.5 Assigns custom role to staff (200), blocks in-use delete (409), restores role, and cleans up (200)', async () => {
    const rolesRes = await client.get<{
      roles: RoleSummary[];
    }>('/api/pos/roles', {
      token: ownerToken,
    });
    expect(rolesRes.status).toBe(200);
    const orderTakerRoleId = rolesRes.body.roles.find((r) => r.name === 'ORDER_TAKER')?.id ?? '';

    // Assign SHIFT_LEAD to staff5
    const assigned = await client.patch(
      `/api/pos/staff/${takerStaffId}/role`,
      {
        roleId: customRoleId,
      },
      {
        token: ownerToken,
      },
    );
    expect(assigned.status).toBe(200);

    // Deleting active role -> 409 ROLE_IN_USE
    const delInUse = await client.delete<{
      code: string;
    }>(`/api/pos/roles/${customRoleId}`, {
      token: ownerToken,
    });
    expect(delInUse.status).toBe(409);
    expect(delInUse.body.code).toBe('ROLE_IN_USE');

    // Restore ORDER_TAKER & soft-delete custom role
    const restored = await client.patch(
      `/api/pos/staff/${takerStaffId}/role`,
      {
        roleId: orderTakerRoleId,
      },
      {
        token: ownerToken,
      },
    );
    expect(restored.status).toBe(200);

    const delOk = await client.delete(`/api/pos/roles/${customRoleId}`, {
      token: ownerToken,
    });
    expect(delOk.status).toBe(200);
  });

  it('2.6 Protects system OWNER role (403 SYSTEM_ROLE_LOCKED) & blocks POS staff from /api/admin/restaurants (401)', async () => {
    const rolesRes = await client.get<{
      roles: RoleSummary[];
    }>('/api/pos/roles', {
      token: ownerToken,
    });
    const ownerRoleId = rolesRes.body.roles.find((r) => r.name === 'OWNER')?.id ?? '';

    const patchOwner = await client.patch<{
      code: string;
    }>(
      `/api/pos/roles/${ownerRoleId}`,
      {
        permissions: [
          'orders:read',
        ],
      },
      {
        token: ownerToken,
      },
    );
    expect(patchOwner.status).toBe(403);
    expect(patchOwner.body.code).toBe('SYSTEM_ROLE_LOCKED');

    const adminRoute = await client.post<{
      code: string;
    }>(
      '/api/admin/restaurants',
      {
        name: 'Unauthorized Cafe',
        subdomain: 'unauth-cafe',
        postcodeSector: 'W1D',
        ownerName: 'Test',
        ownerEmail: 'owner@unauth.co.uk',
        ownerPassword: 'Password123!',
      },
      {
        token: ownerToken,
      },
    );
    expect(adminRoute.status).toBe(401);
    expect(adminRoute.body.code).toBe('UNAUTHORIZED');
  });
});
