import type { UnitOfWork } from '@foodapp/db';
import { describe, expect, it } from 'vitest';
import { AuthorizationPolicy } from '@/core/application/authorization';
import type { ReadRepository } from '@/core/infrastructure/read-repository';
import { UpdateLoyaltyGovernanceHandler } from '@/loyalty/application/commands';
import { GetCustomerLoyaltyHandler } from '@/loyalty/application/queries';
import { LoyaltyWalletAggregate } from '@/loyalty/domain/loyalty-aggregate';

describe('loyalty.maturation-governance — Maturation Window, Holds & Clawback Governance', () => {
  it('enforces pending maturation, checkout holds/releases, and post-spend clawback negative balances', () => {
    const wallet = LoyaltyWalletAggregate.fromSnapshot('wallet-gov-1', {
      holderType: 'CUSTOMER',
      holderId: 'cust-1',
      issuerScope: 'PLATFORM',
      issuerMerchantId: null,
      availablePoints: 200,
      heldPoints: 0,
      pendingMaturationPoints: 0,
    });

    const pendingRes = wallet.accruePendingPoints(
      {
        orderId: 'ord-1',
        sourceType: 'ORDER_EARN',
        pointsEarned: 120,
        maturesAt: new Date('2026-12-07T00:00:00.000Z'),
        expiresAt: new Date('2027-12-07T00:00:00.000Z'),
      },
      {
        actorId: 'system',
      },
    );
    expect(pendingRes.ok).toBe(true);
    expect(wallet.snapshot.pendingMaturationPoints).toBe(120);
    expect(wallet.snapshot.availablePoints).toBe(200);

    const hold = wallet.holdForCheckout(
      {
        orderId: 'ord-2',
        pointsToHold: 150,
        programStatus: 'ACTIVE',
        allowLoyaltyRedeem: true,
      },
      {
        actorId: 'cust-1',
      },
    );
    expect(hold.ok).toBe(true);
    expect(wallet.snapshot.availablePoints).toBe(50);
    expect(wallet.snapshot.heldPoints).toBe(150);

    const commit = wallet.commitHeldPoints('ord-2', 150, {
      actorId: 'system',
    });
    expect(commit.ok).toBe(true);
    expect(wallet.snapshot.heldPoints).toBe(0);
    expect(wallet.snapshot.availablePoints).toBe(50);

    const revoke = wallet.revokePoints('entry-1', 100, 'Chargeback fraud clawback', {
      actorId: 'auditor-1',
    });
    expect(revoke.ok).toBe(true);
    expect(wallet.snapshot.availablePoints).toBe(-50);

    const blockedHold = wallet.holdForCheckout(
      {
        orderId: 'ord-3',
        pointsToHold: 10,
        programStatus: 'ACTIVE',
        allowLoyaltyRedeem: true,
      },
      {
        actorId: 'cust-1',
      },
    );
    expect(blockedHold.ok).toBe(false);
  });
});

// Append to apps/backend/tests/unit/loyalty.maturation-governance.spec.ts
describe('UpdateLoyaltyGovernanceHandler — Merchant Tenant Isolation', () => {
  it('scopes MERCHANT governance updates strictly to the target restaurantId', async () => {
    const executedQueries: Array<{
      text: string;
      params: unknown[];
    }> = [];
    const fakeUow = {
      execute: async (compiled: { text: string; params: unknown[] }) => {
        executedQueries.push({
          text: compiled.text,
          params: compiled.params,
        });
        return 1;
      },
    } as unknown as UnitOfWork;

    const targetRestaurantId = 'a0000000-0000-4000-8000-000000000001';
    const authz = new AuthorizationPolicy({
      requestId: 'req-gov-1',
      actorId: 'staff-1',
      actorSource: 'POS_STAFF',
      restaurantId: targetRestaurantId,
      branchId: 'b0000000-0000-4000-8000-000000000001',
      permissions: [
        'pricing:policy:manage',
      ],
    });

    const handler = new UpdateLoyaltyGovernanceHandler(fakeUow, authz, {
      requestId: 'req-gov-1',
      actorId: 'staff-1',
      actorSource: 'POS_STAFF',
      restaurantId: targetRestaurantId,
      branchId: 'b0000000-0000-4000-8000-000000000001',
      permissions: [
        'pricing:policy:manage',
      ],
    });

    const res = await handler.execute({
      issuerScope: 'MERCHANT',
      restaurantId: targetRestaurantId,
      status: 'PAUSED_REDEEM',
      statusReason: 'Seasonal maintenance',
    });

    expect(res.ok).toBe(true);
    expect(executedQueries[0]?.text).toContain('"restaurantId" =');
    expect(executedQueries[0]?.params).toContain(targetRestaurantId);
  });
});

describe('GetCustomerLoyaltyHandler — Merchant Scope Isolation', () => {
  it('filters recentEntries by issuerMerchantId when querying MERCHANT scope', async () => {
    let capturedSql = '';
    const fakeReadRepo = {
      findMany: async (q: { text: string }) => {
        capturedSql = q.text;
        return [];
      },
    } as unknown as ReadRepository;

    const fakeRepo = {
      loadWalletState: async () => ({
        holderType: 'CUSTOMER' as const,
        holderId: 'cust-1',
        issuerScope: 'MERCHANT' as const,
        issuerMerchantId: 'rest-A',
        availablePoints: 50,
        heldPoints: 0,
        pendingMaturationPoints: 0,
      }),
    };

    const authz = new AuthorizationPolicy({
      requestId: 'req-loy-1',
      actorId: 'cust-1',
      actorSource: 'CUSTOMER',
      permissions: [
        'loyalty:read',
      ],
    });

    const handler = new GetCustomerLoyaltyHandler(fakeReadRepo, fakeRepo as never, authz);
    await handler.execute({
      userId: 'cust-1',
      issuerScope: 'MERCHANT',
      merchantId: 'rest-A',
    });

    expect(capturedSql).toContain('"issuerMerchantId" =');
  });
});
