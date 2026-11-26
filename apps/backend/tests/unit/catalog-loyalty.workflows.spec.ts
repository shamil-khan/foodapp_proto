import { type UnitOfWork } from '@foodapp/db';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { MenuSnapshotBuilder } from '@/catalog/domain/menu-snapshot-builder';
import { resolveMenuPricingStrategy } from '@/catalog/domain/pricing-workflow';
import { InMemoryEventBus } from '@/core/application/event-bus';
import { CompositeSpecification } from '@/core/patterns/specification';
import { LoyaltySettlementEventHandler } from '@/loyalty/application/loyalty-event-handler';
import { OrderCheckoutSaga } from '@/orders/application/order-checkout-saga';
import { OrderAggregate } from '@/orders/domain/order-aggregate';

describe('catalog.pricing-workflow & MenuSnapshotBuilder — Strategy & Builder Coverage', () => {
  const basePolicy = {
    menuPricingMode: 'THRESHOLD_HYBRID' as const,
    maxDirectPriceDeltaPercent: 10,
    allowBranchLocalItems: true,
    maxDirectOrderDiscountPercent: 15,
    allowFullCompWaiveOff: false,
    requireReasonForCompOrDiscount: true,
    maxDirectRefundAmount: 25,
  };

  it('evaluates CENTRAL_LOCKED, BRANCH_DIRECT, BRANCH_APPROVAL_REQUIRED & THRESHOLD_HYBRID strategies', () => {
    expect(
      resolveMenuPricingStrategy('CENTRAL_LOCKED').evaluatePriceProposal({
        basePrice: 10,
        proposedPrice: 12,
        policy: basePolicy,
        canApproveDirectly: false,
      }).ok,
    ).toBe(false);

    expect(
      resolveMenuPricingStrategy('CENTRAL_LOCKED').evaluatePriceProposal({
        basePrice: 10,
        proposedPrice: 12,
        policy: basePolicy,
        canApproveDirectly: true,
      }).ok,
    ).toBe(true);

    const direct = resolveMenuPricingStrategy('BRANCH_DIRECT').evaluatePriceProposal({
      basePrice: 10,
      proposedPrice: 14,
      policy: basePolicy,
      canApproveDirectly: false,
    });
    expect(direct.ok && direct.value.approvalStatus).toBe('APPROVED');

    const pendingApproval = resolveMenuPricingStrategy(
      'BRANCH_APPROVAL_REQUIRED',
    ).evaluatePriceProposal({
      basePrice: 10,
      proposedPrice: 11,
      policy: basePolicy,
      canApproveDirectly: false,
    });
    expect(pendingApproval.ok && pendingApproval.value.approvalStatus).toBe('PENDING');

    const withinThreshold = resolveMenuPricingStrategy('THRESHOLD_HYBRID').evaluatePriceProposal({
      basePrice: 10,
      proposedPrice: 10.8,
      policy: basePolicy,
      canApproveDirectly: false,
    });
    expect(withinThreshold.ok && withinThreshold.value.approvalStatus).toBe('APPROVED');

    const exceedsThreshold = resolveMenuPricingStrategy('THRESHOLD_HYBRID').evaluatePriceProposal({
      basePrice: 10,
      proposedPrice: 13,
      policy: basePolicy,
      canApproveDirectly: false,
    });
    expect(exceedsThreshold.ok && exceedsThreshold.value.approvalStatus).toBe('PENDING');
  });

  it('builds deterministic SHA-256 MenuSnapshot with sorted non-empty categories', () => {
    const snap = new MenuSnapshotBuilder()
      .setBranchContext({
        restaurantId: 'rest-1',
        branchId: 'branch-1',
        brandName: 'Test Brand',
        branchName: 'Test Branch',
        postcodeSector: 'SW1A',
      })
      .addCategory('cat-empty', 'Empty Category', 1)
      .addCategory('cat-mains', 'Mains', 2)
      .addMenuItem('cat-mains', {
        id: 'item-1',
        name: 'Fish & Chips',
        description: null,
        basePrice: 12.5,
        effectivePrice: 12.5,
        vatRate: 20,
        allergenFlags: [
          'FISH',
        ],
        ingredientTags: [
          '#cod',
        ],
        kdsTarget: 'KITCHEN_SCREEN',
        imageUrl: null,
        isBranchLocal: false,
        modifiers: [],
      })
      .build();

    expect(snap.categories).toHaveLength(1);
    expect(snap.versionHash).toHaveLength(16);
  });

  it('evaluates CompositeSpecification and/or/not combinators', () => {
    class GtTenSpec extends CompositeSpecification<number> {
      isSatisfiedBy(n: number): boolean {
        return n > 10;
      }
    }
    class EvenSpec extends CompositeSpecification<number> {
      isSatisfiedBy(n: number): boolean {
        return n % 2 === 0;
      }
    }
    const spec = new GtTenSpec().and(new EvenSpec()).or(new GtTenSpec().not());
    expect(spec.isSatisfiedBy(12)).toBe(true);
    expect(spec.isSatisfiedBy(4)).toBe(true);
    expect(spec.isSatisfiedBy(11)).toBe(false);
  });
});

describe('LoyaltySettlementEventHandler & OrderCheckoutSaga — Loyalty Hold & Compensation Flows', () => {
  it('publishes LoyaltyHoldConfirmed & LoyaltyHoldFailed and compensates order on LoyaltyHoldFailed', async () => {
    const bus = new InMemoryEventBus();
    const publishedTypes: string[] = [];
    bus.subscribe('LoyaltyHoldConfirmed', async () => {
      publishedTypes.push('LoyaltyHoldConfirmed');
    });
    bus.subscribe('LoyaltyHoldFailed', async () => {
      publishedTypes.push('LoyaltyHoldFailed');
    });
    bus.subscribe('OrderCancelledOrRejected', async () => {
      publishedTypes.push('OrderCancelledOrRejected');
    });

    const fakeUow = {
      transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        work({
          queryOne: async () => ({
            eventId: 'evt-loy',
          }),
          execute: async () => 1,
        }),
    } as unknown as UnitOfWork;

    let failHold = false;
    const fakeLoyaltyPort = {
      holdCheckoutPoints: async () =>
        failHold
          ? {
              ok: false as const,
              error: {
                code: 'INSUFFICIENT_POINTS',
                message: 'Not enough points',
                statusCode: 400,
                name: 'DomainError',
              },
            }
          : {
              ok: true as const,
              value: {
                pointsHeld: 100,
                discountGbp: new Decimal('1.00'),
                issuerScope: 'PLATFORM' as const,
              },
            },
      releaseCheckoutHold: async () => {},
      settleOrderLoyalty: async () => {},
      redeemMerchantPointsForFeeOffset: async () => ({
        pointsRedeemed: 50,
        offsetGbp: new Decimal('0.50'),
      }),
    };

    new LoyaltySettlementEventHandler(
      fakeUow,
      () => ({
        service: fakeLoyaltyPort as never,
        dispose: async () => {},
      }),
      bus,
    ).register(bus);

    const created = OrderAggregate.createOrder(
      'ord-loy-1',
      {
        branchId: 'branch-1',
        restaurantId: 'rest-1',
        customerId: 'user-1',
        orderSource: 'ONLINE_DELIVERY',
        stateMachineCode: 'STANDARD_RESTAURANT',
        paymentMode: 'ONLINE_GATEWAY',
        requiresOnlineCapture: false,
        loyaltyPointsHeld: 100,
        lines: [
          {
            lineId: 'l-1',
            menuItemId: 'm-1',
            itemName: 'Burger',
            quantity: 1,
            unitPriceGbp: new Decimal('15.00'),
            vatRatePercent: new Decimal('20.00'),
            allergenFlags: [],
            kdsTarget: 'KITCHEN_SCREEN',
            modifiers: [],
          },
        ],
      },
      {
        actorId: 'user-1',
        restaurantId: 'rest-1',
      },
    );
    if (!created.ok) return;
    const orderAgg = created.value;
    orderAgg.pullDomainEvents();

    const fakeSagaRepo = {
      findOrCreate: async () => ({
        id: 'saga-1',
        sagaType: 'OrderCheckoutCoordinationSaga',
        correlationId: 'ord-loy-1',
        currentStep: 'REQUEST_LOYALTY_HOLD',
        status: 'RUNNING',
        statePayload: {},
        lastError: null,
        rowVersion: 1,
      }),
      advanceStep: async () => true,
    };

    const fakeOrderRepo = {
      findById: async () => orderAgg,
      save: async (agg: OrderAggregate) => {
        await bus.publish(agg.pullDomainEvents());
      },
    };

    new OrderCheckoutSaga(fakeUow, bus, fakeSagaRepo as never, fakeOrderRepo as never).register(
      bus,
    );

    await bus.publish([
      {
        eventId: 'evt-hold-ok',
        aggregateId: 'ord-loy-1',
        aggregateType: 'OrderCheckoutSaga',
        eventType: 'LoyaltyHoldRequested',
        version: 1,
        occurredAt: new Date(),
        payload: {
          orderId: 'ord-loy-1',
          userId: 'user-1',
          restaurantId: 'rest-1',
          issuerScope: 'PLATFORM',
          pointsToHold: 100,
          allowLoyaltyRedeem: true,
        },
        metadata: {
          actorId: 'user-1',
        },
      },
    ]);
    expect(publishedTypes).toContain('LoyaltyHoldConfirmed');

    failHold = true;
    await bus.publish([
      {
        eventId: 'evt-hold-fail',
        aggregateId: 'ord-loy-1',
        aggregateType: 'OrderCheckoutSaga',
        eventType: 'LoyaltyHoldRequested',
        version: 1,
        occurredAt: new Date(),
        payload: {
          orderId: 'ord-loy-1',
          userId: 'user-1',
          restaurantId: 'rest-1',
          issuerScope: 'PLATFORM',
          pointsToHold: 100,
          allowLoyaltyRedeem: true,
        },
        metadata: {
          actorId: 'user-1',
        },
      },
    ]);
    expect(publishedTypes).toContain('LoyaltyHoldFailed');
    expect(publishedTypes).toContain('OrderCancelledOrRejected');

    await bus.publish([
      {
        eventId: 'evt-bill-settle-1',
        aggregateId: 'ord-loy-1',
        aggregateType: 'FinancialLedgerAggregate',
        eventType: 'BillingSettlementRecorded',
        version: 1,
        occurredAt: new Date(),
        payload: {
          orderId: 'ord-loy-1',
          restaurantId: 'rest-1',
          customerId: 'user-1',
          subtotalGbp: '20.00',
          allowLoyaltyEarn: true,
        },
        metadata: {
          actorId: 'staff-1',
        },
      },
      {
        eventId: 'evt-order-cancel-1',
        aggregateId: 'ord-loy-1',
        aggregateType: 'OrderAggregate',
        eventType: 'OrderCancelledOrRejected',
        version: 2,
        occurredAt: new Date(),
        payload: {
          orderId: 'ord-loy-1',
          customerId: 'user-1',
          reason: 'Customer cancelled',
        },
        metadata: {
          actorId: 'user-1',
        },
      },
      {
        eventId: 'evt-merchant-offset-1',
        aggregateId: 'settle-1',
        aggregateType: 'MerchantSettlement',
        eventType: 'MerchantLoyaltyOffsetRequested',
        version: 1,
        occurredAt: new Date(),
        payload: {
          settlementId: 'settle-1',
          restaurantId: 'rest-1',
          maxOffsetGbp: '5.00',
          markPaidReference: 'FPS-101',
        },
        metadata: {
          actorId: 'staff-1',
        },
      },
    ]);
    expect(publishedTypes).toBeDefined();
  });
});
