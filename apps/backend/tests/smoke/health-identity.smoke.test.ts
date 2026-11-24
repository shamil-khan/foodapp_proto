import { describe, expect, it } from 'vitest';
import { ApiTestClient, loginPosStaff } from '../helpers/api-client.js';

describe('Platform Health, Identity & Branch Switching', () => {
  const client = new ApiTestClient();
  let ownerToken = '';

  it('GET /api/health returns 200 OK', async () => {
    const res = await client.get<{
      status: string;
      service: string;
    }>('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('foodapp-backend');
  });

  it('GET /api/doc returns OpenAPI 3.1 JSON', async () => {
    const res = await client.get<{
      openapi: string;
    }>('/api/doc');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\.1/);
  });

  it('GET /api/me returns 401 when unauthenticated', async () => {
    const res = await client.get('/api/me');
    expect(res.status).toBe(401);
  });

  it('POST /api/pos/auth/login returns 400 on malformed payload', async () => {
    const res = await client.post<{
      code: string;
    }>('/api/pos/auth/login', {
      brandHandle: 'pizza-hut',
      email: 'not-an-email',
      password: '',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/pos/auth/login returns 401 for unknown brandHandle', async () => {
    const res = await client.post<{
      code: string;
    }>('/api/pos/auth/login', {
      brandHandle: 'non-existent-brand',
      email: 'tom@pizza-hut.com',
      password: 'Password123!',
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('logs in Pizza Hut Owner (Tom) and inspects 18 rights via GET /api/me', async () => {
    ownerToken = await loginPosStaff(client, {
      brandHandle: 'pizza-hut',
      email: 'tom@pizza-hut.com',
      password: 'Password123!',
    });

    const me = await client.get<{
      actor: {
        source: string;
        permissions: string[];
      };
    }>('/api/me', {
      token: ownerToken,
    });

    expect(me.status).toBe(200);
    expect(me.body.actor.source).toBe('POS_STAFF');
    expect(me.body.actor.permissions).toHaveLength(18);
  });

  it('rejects cross-brand branch switch with 403 BRANCH_FORBIDDEN', async () => {
    const res = await client.post<{
      code: string;
    }>(
      '/api/pos/auth/switch-branch',
      {
        targetBranchId: 'b0000000-0000-4000-8000-000000000004',
      },
      {
        token: ownerToken,
      },
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('BRANCH_FORBIDDEN');
  });

  it('switches active branch to Pizza Hut Edgbaston (200)', async () => {
    const targetBranchId = 'b0000000-0000-4000-8000-000000000007';
    const res = await client.post<{
      success: boolean;
      staff: {
        activeBranchId: string;
        activeBranchKey: string;
      };
    }>(
      '/api/pos/auth/switch-branch',
      {
        targetBranchId,
      },
      {
        token: ownerToken,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.staff.activeBranchId).toBe(targetBranchId);
    expect(res.body.staff.activeBranchKey).toBe('edgbaston');
  });
});
