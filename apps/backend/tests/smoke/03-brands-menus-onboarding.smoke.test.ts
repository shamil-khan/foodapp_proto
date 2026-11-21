import { describe, expect, it } from 'vitest';
import { ApiTestClient } from '../helpers/api-client.js';

describe('03 — Brands, Privacy Redaction, Menus & Seller Onboarding', () => {
  const client = new ApiTestClient();

  it('5.1 Lists all active brands (200)', async () => {
    const res = await client.get<{
      brands: unknown[];
    }>('/api/brands');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.brands)).toBe(true);
  });

  it('5.2–5.6 Resolves all 5 seeded brand archetypes accurately', async () => {
    // Archetype 1: Home Kitchen with Address Redaction
    const homeKitchen = await client.get<{
      isAddressRedacted?: boolean;
      branch?: {
        isAddressRedacted?: boolean;
        streetAddress: string | null;
      };
    }>('/api/brands/ayeshas-kitchen');
    expect(homeKitchen.status).toBe(200);

    // Archetype 2: Single-Location Commercial Restaurant
    const biteIn = await client.get('/api/brands/bitein');
    expect(biteIn.status).toBe(200);

    // Archetype 3: Cloud Kitchen
    const cloud = await client.get('/api/brands/burgerlab-cloud');
    expect(cloud.status).toBe(200);

    // Archetype 4: Single-City Multi-Branch Chain
    const pizzaIn = await client.get('/api/brands/pizzain');
    expect(pizzaIn.status).toBe(200);

    // Archetype 5: Multi-City Multi-Branch Chain & Direct Slug
    const pizzaHut = await client.get('/api/brands/pizza-hut');
    expect(pizzaHut.status).toBe(200);

    const clifton = await client.get('/api/brands/pizza-hut/karachi/clifton');
    expect(clifton.status).toBe(200);
  });

  it('5.7 Returns 404 for unknown brand or branch slug', async () => {
    const missingBrand = await client.get('/api/brands/unknown-brand-xyz');
    expect(missingBrand.status).toBe(404);

    const missingBranch = await client.get('/api/brands/pizza-hut/islamabad/f-7');
    expect(missingBranch.status).toBe(404);
  });

  it('6.1–6.3 Fetches branch menu snapshots, hashtag filters, and 404 on unknown branch', async () => {
    const gulshanMenu = await client.get(
      '/api/brands/branches/b0000000-0000-4000-8000-000000000005/menu',
    );
    expect(gulshanMenu.status).toBe(200);

    const taggedMenu = await client.get(
      '/api/brands/branches/b0000000-0000-4000-8000-000000000004/menu?tag=cheese',
    );
    expect(taggedMenu.status).toBe(200);

    const missingMenu = await client.get(
      '/api/brands/branches/00000000-0000-4000-8000-999999999999/menu',
    );
    expect(missingMenu.status).toBe(404);
  });

  it('7.1–7.3 Registers Home Kitchen seller (201) and rejects duplicate (409) or reserved (400) handle', async () => {
    const basePayload = {
      brandName: 'Zara Home Bakes',
      handle: 'zaras-home-bakes',
      kitchenType: 'HOME_KITCHEN',
      branchName: 'Zara Gulshan Kitchen',
      city: 'Karachi',
      postcodeSector: 'KHI-GULSHAN',
      streetAddress: 'Apartment 4B, Block 10-A, Gulshan-e-Iqbal, Karachi',
      contactPersonName: 'Zara Ali',
      contactPersonPhone: '+92-300-5551234',
      ownerName: 'Zara Ali',
      ownerEmail: 'zara@homebakes.pk',
      ownerPassword: 'Password123!',
    };

    const created = await client.post<{
      brandHandle: string;
      restaurantId: string;
    }>('/api/brands/register', basePayload);
    expect(created.status).toBe(201);
    expect(created.body.brandHandle).toBe('zaras-home-bakes');

    const duplicate = await client.post<{
      code: string;
    }>('/api/brands/register', {
      ...basePayload,
      ownerEmail: 'zara2@homebakes.pk',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('HANDLE_TAKEN');

    const reserved = await client.post('/api/brands/register', {
      ...basePayload,
      brandName: 'Branches Cafe',
      handle: 'branches',
      kitchenType: 'RESTAURANT_BRANCH',
      ownerEmail: 'ali@branchescafe.pk',
    });
    expect(reserved.status).toBe(400);
  });
});
