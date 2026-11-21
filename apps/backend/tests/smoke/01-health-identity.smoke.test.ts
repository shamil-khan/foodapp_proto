import { describe, expect, it } from 'vitest';
import { ApiTestClient, loginPosStaff } from '../helpers/api-client.js';

describe('01 — Platform Health, Identity & Branch Switching', () => {
  const client = new ApiTestClient();
  let ownerToken = '';

  it('1.1 GET /api/health returns 200 OK', async () => {
    const res = await client.get<{
      status: string;
      service: string;
    }>('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('foodapp-backend');
  });

  it('1.2 GET /api/doc returns OpenAPI 3.1 JSON', async () => {
    const res = await client.get<{
      openapi: string;
    }>('/api/doc');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\.1/);
  });

  it('2.1 GET /api/me returns 401 when unauthenticated', async () => {
    const res = await client.get('/api/me');
    expect(res.status).toBe(401);
  });

  // it('2.2–2.3 Customer signs up via Better Auth and gets 403 on POS RBAC route', async () => {
  //   const uniqueEmail = `customer.${Date.now()}@ukmail.co.uk`;
  //   const signUp = await client.post(
  //     '/api/auth/sign-up/email',
  //     {
  //       name: 'Test Customer',
  //       email: uniqueEmail,
  //       password: 'Password123!',
  //     },
  //     {
  //       useCookies: true,
  //     },
  //   );
  //   expect(signUp.status).toBe(200);

  //   const forbidden = await client.get<{
  //     code: string;
  //   }>('/api/pos/roles/rights', {
  //     useCookies: true,
  //   });
  //   expect(forbidden.status).toBe(403);
  //   expect(forbidden.body.code).toBe('INSUFFICIENT_RIGHTS');
  // });

  it('3.1 POST /api/pos/auth/login returns 400 on malformed payload', async () => {
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

  it('3.2 POST /api/pos/auth/login returns 401 for unknown brandHandle', async () => {
    const res = await client.post<{
      code: string;
    }>('/api/pos/auth/login', {
      brandHandle: 'non-existent-brand',
      email: 'owner@pizza-hut.example.com',
      password: 'Password123!',
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('3.3–3.4 Logs in Pizza Hut Owner and inspects 17 rights via GET /api/me', async () => {
    ownerToken = await loginPosStaff(client, {
      brandHandle: 'pizza-hut',
      email: 'owner@pizza-hut.example.com',
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
    expect(me.body.actor.permissions).toHaveLength(17);
  });

  it('3.5 Rejects cross-brand branch switch with 403 BRANCH_FORBIDDEN', async () => {
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

  it('3.6 Switches active branch to Pizza Hut Gulberg Lahore (200)', async () => {
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
    expect(res.body.staff.activeBranchKey).toBe('gulberg');
  });
});
