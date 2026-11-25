import { beforeAll, describe, expect, it } from 'vitest';
import { ApiTestClient, loginPosStaff } from '../helpers/api-client.js';

describe('POS Branches, Pricing Policies & Branch Menu Overrides', () => {
  const client = new ApiTestClient();
  const cliftonBranchId = 'b0000000-0000-4000-8000-000000000006';
  const tomStaffId = 'c0000000-0000-4000-8000-000000000007';
  const uniqueBranchKey = `headingley-${Date.now()}`;
  let ownerToken = '';
  let createdBranchId = '';

  beforeAll(async () => {
    ownerToken = await loginPosStaff(client, {
      brandHandle: 'pizza-hut',
      email: 'tom@pizza-hut.com',
      password: 'Password123!',
      branchId: cliftonBranchId,
    });
  });

  it('creates Headingley branch (201) and rejects duplicate branchKey (409)', async () => {
    const branchPayload = {
      name: 'Pizza Hut Headingley',
      branchKey: uniqueBranchKey,
      city: 'Leeds',
      kitchenType: 'RESTAURANT_BRANCH',
      postcodeSector: 'LS6',
      streetAddress: '32 Otley Road, Headingley, Leeds LS6 2AL',
      contactPersonName: 'Ben',
      contactPersonPhone: '+44-113-496-0877',
    };

    const created = await client.post<{
      branchId: string;
      cityKey: string;
      branchKey: string;
    }>('/api/pos/brands/branches', branchPayload, {
      token: ownerToken,
    });
    expect(created.status).toBe(201);
    expect(created.body.cityKey).toBe('leeds');
    expect(created.body.branchKey).toBe(uniqueBranchKey);
    createdBranchId = created.body.branchId;

    const dup = await client.post<{
      code: string;
    }>('/api/pos/brands/branches', branchPayload, {
      token: ownerToken,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('BRANCH_EXISTS');
  });

  it('sets BUSY_PAUSED lock (200), enforces cooldown (409), and updates settings/whitelist', async () => {
    const rolesRes = await client.get<{
      roles: Array<{
        id: string;
        name: string;
      }>;
    }>('/api/pos/roles', {
      token: ownerToken,
    });
    const ownerRoleId = rolesRes.body.roles.find((r) => r.name === 'BRAND_OWNER')?.id ?? '';
    const assign = await client.patch(
      `/api/pos/staff/${tomStaffId}/branch-access`,
      {
        branchId: createdBranchId,
        roleId: ownerRoleId,
      },
      {
        token: ownerToken,
      },
    );
    expect(assign.status).toBe(200);

    const branchToken = await loginPosStaff(client, {
      brandHandle: 'pizza-hut',
      email: 'tom@pizza-hut.com',
      password: 'Password123!',
      branchId: createdBranchId,
    });

    const pause = await client.patch<{
      operationalStatus: string;
    }>(
      `/api/pos/brands/branches/${createdBranchId}/status`,
      {
        operationalStatus: 'BUSY_PAUSED',
        reason: 'Oven maintenance',
      },
      {
        token: branchToken,
      },
    );
    expect(pause.status).toBe(200);
    expect(pause.body.operationalStatus).toBe('BUSY_PAUSED');

    const cooldown = await client.patch<{
      code: string;
    }>(
      `/api/pos/brands/branches/${createdBranchId}/status`,
      {
        operationalStatus: 'OPEN',
      },
      {
        token: branchToken,
      },
    );
    expect(cooldown.status).toBe(409);
    expect(cooldown.body.code).toBe('STATUS_COOLDOWN_ACTIVE');

    const settings = await client.patch(
      `/api/pos/brands/branches/${createdBranchId}/settings`,
      {
        supportsTakeaway: true,
        menuSelectionMode: 'ALL_BRAND_ITEMS',
      },
      {
        token: branchToken,
      },
    );
    expect(settings.status).toBe(200);

    const whitelist = await client.post(
      `/api/pos/brands/branches/${createdBranchId}/whitelist`,
      {
        customerUserId: '11111111-1111-4111-8111-111111111112',
        decision: 'APPROVED',
      },
      {
        token: branchToken,
      },
    );
    expect(whitelist.status).toBe(200);
  });

  it('creates branch menu item, updates PricingPolicy, applies override, and handles 404 review', async () => {
    const itemOk = await client.post<{
      menuItemId: string;
    }>(
      '/api/pos/catalog/items',
      {
        categoryId: 'd0000000-0000-4000-8000-000000000005',
        branchId: cliftonBranchId,
        name: 'Clifton Garlic Chicken Melt',
        description: 'Branch exclusive stuffed garlic crust',
        basePrice: 18.5,
        ingredientTags: [
          'chicken',
          '#cheese',
          'garlic',
        ],
      },
      {
        token: ownerToken,
      },
    );
    expect(itemOk.status).toBe(201);

    const itemBadCategory = await client.post(
      '/api/pos/catalog/items',
      {
        categoryId: '00000000-0000-4000-8000-999999999999',
        name: 'Invalid Category Item',
        basePrice: 10.0,
      },
      {
        token: ownerToken,
      },
    );
    expect(itemBadCategory.status).toBe(404);

    const policy = await client.put(
      '/api/pos/catalog/pricing-policy',
      {
        menuPricingMode: 'BRANCH_DIRECT',
        maxDirectPriceDeltaPercent: 20,
        allowBranchLocalItems: true,
        maxDirectOrderDiscountPercent: 15,
        allowFullCompWaiveOff: true,
        requireReasonForCompOrDiscount: true,
        maxDirectRefundAmount: 50,
      },
      {
        token: ownerToken,
      },
    );
    expect(policy.status).toBe(200);

    const menuItemId = 'e0000000-0000-4000-8000-000000000006';
    const override = await client.put(
      `/api/pos/catalog/branches/${cliftonBranchId}/menu/${menuItemId}`,
      {
        isIncluded: true,
        isAvailable: true,
        proposedPrice: 18.99,
      },
      {
        token: ownerToken,
      },
    );
    expect(override.status).toBe(200);

    const missingReview = await client.post(
      `/api/pos/catalog/branches/${cliftonBranchId}/menu/${menuItemId}/review`,
      {
        decision: 'APPROVED',
      },
      {
        token: ownerToken,
      },
    );
    expect(missingReview.status).toBe(404);
  });
});
