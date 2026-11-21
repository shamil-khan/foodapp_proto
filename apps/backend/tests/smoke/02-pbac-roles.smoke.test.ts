import { beforeAll, describe, expect, it } from 'vitest';
import { ApiTestClient, loginPosStaff } from '../helpers/api-client.js';

interface RoleSummary {
  id: string;
  name: string;
  isSystemRole: boolean;
}

describe('02 — PBAC Rights, Custom Roles & Privilege Guards', () => {
  const client = new ApiTestClient();
  const handle = `pbac-brand-${Date.now()}`;
  const ownerEmail = `owner@${handle}.example.com`;

  let primaryBranchId = '';
  let secondaryBranchId = '';
  let ownerToken = '';
  let sysRoleId = '';
  let ownerRoleId = '';
  let ownerStaffId = '';
  let customRoleId = '';

  beforeAll(async () => {
    const reg = await client.post<{
      branchId: string;
      ownerStaffId: string;
    }>('/api/brands/register', {
      brandName: 'PBAC Test Brand',
      handle,
      kitchenType: 'RESTAURANT_BRANCH',
      isMultiBranchEnterprise: true,
      branchName: 'Main Branch',
      city: 'Karachi',
      postcodeSector: 'KHI-DHA',
      streetAddress: '10 Main Boulevard, DHA, Karachi',
      contactPersonName: 'PBAC Owner',
      contactPersonPhone: '+92-300-7000001',
      ownerName: 'PBAC Owner',
      ownerEmail,
      ownerPassword: 'Password123!',
    });
    expect(reg.status).toBe(201);
    primaryBranchId = reg.body.branchId;
    ownerStaffId = reg.body.ownerStaffId;

    ownerToken = await loginPosStaff(client, {
      brandHandle: handle,
      email: ownerEmail,
      password: 'Password123!',
      branchId: primaryBranchId,
    });

    const secondBranch = await client.post<{
      branchId: string;
    }>(
      '/api/brands/pos/branches',
      {
        name: 'Secondary Branch',
        city: 'Lahore',
        kitchenType: 'RESTAURANT_BRANCH',
        postcodeSector: 'LHR-DHA',
        streetAddress: '20 Sector Y, DHA, Lahore',
        contactPersonName: 'PBAC Branch Lead',
        contactPersonPhone: '+92-300-7000002',
      },
      {
        token: ownerToken,
      },
    );
    expect(secondBranch.status).toBe(201);
    secondaryBranchId = secondBranch.body.branchId;
  });

  it('4.1–4.2 Lists 17 rights and predefined brand roles', async () => {
    const rights = await client.get<{
      rights: unknown[];
    }>('/api/pos/roles/rights', {
      token: ownerToken,
    });
    expect(rights.status).toBe(200);
    expect(rights.body.rights).toHaveLength(17);

    const roles = await client.get<{
      roles: RoleSummary[];
    }>('/api/pos/roles', {
      token: ownerToken,
    });
    expect(roles.status).toBe(200);
    sysRoleId = roles.body.roles.find((r) => r.isSystemRole)?.id ?? '';
    ownerRoleId = roles.body.roles.find((r) => r.name === 'BRAND_OWNER')?.id ?? '';
    expect(sysRoleId).not.toBe('');
    expect(ownerRoleId).not.toBe('');
  });

  it('4.3–4.5 Creates custom role, rejects duplicate (409), and updates permissions', async () => {
    const created = await client.post<{
      roleId: string;
    }>(
      '/api/pos/roles',
      {
        name: 'EVENING_FLOOR_LEAD',
        description: 'Evening cashier and floor order taking',
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
        name: 'EVENING_FLOOR_LEAD',
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
        permissions: [
          'orders:read',
          'orders:place',
          'orders:settle',
          'orders:discount:apply',
          'staff:manage',
        ],
      },
      {
        token: ownerToken,
      },
    );
    expect(updated.status).toBe(200);
  });

  it('4.6 Blocks editing or deleting predefined system roles (403 SYSTEM_ROLE_LOCKED)', async () => {
    const patchSys = await client.patch<{
      code: string;
    }>(
      `/api/pos/roles/${sysRoleId}`,
      {
        permissions: [
          'orders:read',
        ],
      },
      {
        token: ownerToken,
      },
    );
    expect(patchSys.status).toBe(403);
    expect(patchSys.body.code).toBe('SYSTEM_ROLE_LOCKED');

    const delSys = await client.delete<{
      code: string;
    }>(`/api/pos/roles/${sysRoleId}`, {
      token: ownerToken,
    });
    expect(delSys.status).toBe(403);
    expect(delSys.body.code).toBe('SYSTEM_ROLE_LOCKED');
  });

  it('4.7–4.9 Applies live Redis permission refresh and blocks privilege escalation (403)', async () => {
    const secondaryToken = await loginPosStaff(client, {
      brandHandle: handle,
      email: ownerEmail,
      password: 'Password123!',
      branchId: secondaryBranchId,
    });

    const assign = await client.patch(
      `/api/pos/staff/${ownerStaffId}/branch-access`,
      {
        branchId: secondaryBranchId,
        roleId: customRoleId,
        directPermissions: [
          'branch:status:manage',
        ],
      },
      {
        token: secondaryToken,
      },
    );
    expect(assign.status).toBe(200);

    const me = await client.get<{
      actor: {
        permissions: string[];
      };
    }>('/api/me', {
      token: secondaryToken,
    });
    expect(me.status).toBe(200);
    expect(me.body.actor.permissions).toHaveLength(6);

    const escalate = await client.post<{
      code: string;
    }>(
      '/api/pos/roles',
      {
        name: 'ESCALATED_ADMIN',
        permissions: [
          'pricing:policy:manage',
        ],
      },
      {
        token: secondaryToken,
      },
    );
    expect(escalate.status).toBe(403);
    expect(escalate.body.code).toBe('INSUFFICIENT_RIGHTS');
  });

  it('4.10–4.11 Rejects deleting active role (409) and logs out cleanly', async () => {
    const delInUse = await client.delete<{
      code: string;
    }>(`/api/pos/roles/${customRoleId}`, {
      token: ownerToken,
    });
    expect(delInUse.status).toBe(409);
    expect(delInUse.body.code).toBe('ROLE_IN_USE');

    const logout = await client.post('/api/pos/auth/logout', undefined, {
      token: ownerToken,
    });
    expect(logout.status).toBe(200);
  });
});
