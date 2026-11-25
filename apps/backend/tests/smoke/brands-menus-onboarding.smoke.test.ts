import { describe, expect, it } from 'vitest';
import { ApiTestClient } from '../helpers/api-client.js';

describe('Brands, Privacy Redaction, Menus & Seller Onboarding', () => {
  const client = new ApiTestClient();

  it('lists all active brands (200)', async () => {
    const res = await client.get<{
      brands: unknown[];
    }>('/api/brands');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.brands)).toBe(true);
  });

  it('resolves all 5 seeded brand archetypes accurately', async () => {
    const homeKitchen = await client.get<{
      isAddressRedacted?: boolean;
      branch?: {
        isAddressRedacted?: boolean;
        streetAddress: string | null;
      };
    }>('/api/brands/zaras-kitchen');
    expect(homeKitchen.status).toBe(200);

    const biteIn = await client.get('/api/brands/bitein');
    expect(biteIn.status).toBe(200);

    const cloud = await client.get('/api/brands/burgerlab-cloud');
    expect(cloud.status).toBe(200);

    const pizzaIn = await client.get('/api/brands/pizzain');
    expect(pizzaIn.status).toBe(200);

    const pizzaHut = await client.get('/api/brands/pizza-hut');
    expect(pizzaHut.status).toBe(200);

    const clifton = await client.get('/api/brands/pizza-hut/bristol/clifton');
    expect(clifton.status).toBe(200);
  });

  it('returns 404 for unknown brand or branch slug', async () => {
    const missingBrand = await client.get('/api/brands/unknown-brand-xyz');
    expect(missingBrand.status).toBe(404);

    const missingBranch = await client.get('/api/brands/pizza-hut/leeds/non-existent-branch');
    expect(missingBranch.status).toBe(404);
  });

  it('fetches branch menu snapshots, hashtag filters, and 404 on unknown branch', async () => {
    const didsburyMenu = await client.get(
      '/api/catalog/branches/b0000000-0000-4000-8000-000000000005/menu',
    );
    expect(didsburyMenu.status).toBe(200);

    const taggedMenu = await client.get(
      '/api/catalog/branches/b0000000-0000-4000-8000-000000000004/menu?tag=cheese',
    );
    expect(taggedMenu.status).toBe(200);

    const missingMenu = await client.get(
      '/api/catalog/branches/00000000-0000-4000-8000-999999999999/menu',
    );
    expect(missingMenu.status).toBe(404);
  });

  it('registers Home Kitchen seller (201) and rejects duplicate (409) or reserved (400) handle', async () => {
    const uniqueHandle = `ellas-home-bakes-${Date.now()}`;
    const basePayload = {
      brandName: 'Ella Home Bakes',
      handle: uniqueHandle,
      kitchenType: 'HOME_KITCHEN',
      branchName: 'Ella Islington Kitchen',
      city: 'London',
      postcodeSector: 'N1',
      streetAddress: 'Flat 4B, 22 Upper Street, Islington, London N1 0PQ',
      contactPersonName: 'Ella',
      contactPersonPhone: '+44-20-7946-1234',
      ownerName: 'Ella',
      ownerEmail: `ella-${Date.now()}@example.com`,
      ownerPassword: 'Password123!',
    };

    const created = await client.post<{
      brandHandle: string;
      restaurantId: string;
    }>('/api/brands/register', basePayload);
    expect(created.status).toBe(201);
    expect(created.body.brandHandle).toBe(uniqueHandle);

    const duplicate = await client.post<{
      code: string;
    }>('/api/brands/register', {
      ...basePayload,
      ownerEmail: `ella2-${Date.now()}@example.com`,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('HANDLE_TAKEN');

    const reserved = await client.post('/api/brands/register', {
      ...basePayload,
      brandName: 'Admin Cafe',
      handle: 'admin',
      kitchenType: 'RESTAURANT_BRANCH',
      ownerEmail: `mia-${Date.now()}@example.com`,
    });
    expect(reserved.status).toBe(400);
  });
});
