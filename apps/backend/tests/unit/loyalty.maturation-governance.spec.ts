import { describe, expect, it } from 'vitest';
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
