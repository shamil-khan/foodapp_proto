import { beforeAll, describe, expect, it } from 'vitest';
import { ApiTestClient, loginPosStaff } from '../helpers/api-client.js';

describe('04 — POS Branches, Pricing Policies & Order Settlement', () => {
  const client = new ApiTestClient();
  const cliftonBranchId = 'b0000000-0000-4000-8000-000000000006';
  let ownerToken = '';

  beforeAll(async () => {
    ownerToken = await loginPosStaff(client, {
      brandHandle: 'pizza-hut',
      email: 'owner@pizza-hut.example.com',
      password: 'Password123!',
      branchId: cliftonBranchId,
    });
  });

  it('8.1–8.2 Creates Islamabad F-7 branch (201) and rejects duplicate branchKey (409)', async () => {
    const branchPayload = {
      name: 'Pizza Hut F-7 Markaz',
      branchKey: 'f-7-markaz',
      city: 'Islamabad',
      kitchenType: 'RESTAURANT_BRANCH',
      postcodeSector: 'ISB-F7',
      streetAddress: 'Jinnah Super Market, F-7 Markaz, Islamabad',
      contactPersonName: 'Tariq Mahmood',
      contactPersonPhone: '+92-300-9998877',
    };

    const created = await client.post<{
      cityKey: string;
      branchKey: string;
    }>('/api/brands/pos/branches', branchPayload, {
      token: ownerToken,
    });
    expect(created.status).toBe(201);
    expect(created.body.cityKey).toBe('islamabad');
    expect(created.body.branchKey).toBe('f-7-markaz');

    const dup = await client.post<{
      code: string;
    }>('/api/brands/pos/branches', branchPayload, {
      token: ownerToken,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('BRANCH_EXISTS');
  });

  it('8.3–8.5 Sets BUSY_PAUSED lock (200), enforces cooldown (409), and updates settings/whitelist', async () => {
    const pause = await client.patch<{
      operationalStatus: string;
    }>(
      `/api/brands/pos/branches/${cliftonBranchId}/status`,
      {
        operationalStatus: 'BUSY_PAUSED',
        reason: 'Oven maintenance',
      },
      {
        token: ownerToken,
      },
    );
    expect(pause.status).toBe(200);
    expect(pause.body.operationalStatus).toBe('BUSY_PAUSED');

    const cooldown = await client.patch<{
      code: string;
    }>(
      `/api/brands/pos/branches/${cliftonBranchId}/status`,
      {
        operationalStatus: 'OPEN',
      },
      {
        token: ownerToken,
      },
    );
    expect(cooldown.status).toBe(409);
    expect(cooldown.body.code).toBe('STATUS_COOLDOWN_ACTIVE');

    const settings = await client.patch(
      `/api/brands/pos/branches/${cliftonBranchId}/settings`,
      {
        supportsTakeaway: true,
        menuSelectionMode: 'ALL_BRAND_ITEMS',
      },
      {
        token: ownerToken,
      },
    );
    expect(settings.status).toBe(200);

    const whitelist = await client.post(
      `/api/brands/pos/branches/${cliftonBranchId}/whitelist`,
      {
        customerUserId: '11111111-1111-4111-8111-111111111112',
        decision: 'APPROVED',
      },
      {
        token: ownerToken,
      },
    );
    expect(whitelist.status).toBe(200);
  });

  it('9.1–9.4 Creates branch menu item, updates PricingPolicy, applies override, and handles 404 review', async () => {
    const itemOk = await client.post<{
      menuItemId: string;
    }>(
      '/api/brands/pos/items',
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
      '/api/brands/pos/items',
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
      '/api/brands/pos/pricing-policy',
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
      `/api/brands/pos/branches/${cliftonBranchId}/menu/${menuItemId}`,
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
      `/api/brands/pos/branches/${cliftonBranchId}/menu/${menuItemId}/review`,
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
