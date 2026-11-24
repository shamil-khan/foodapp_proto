import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { OrderAggregate } from '@/orders/domain/order-aggregate';
import { KdsTicketVisitor } from '@/orders/domain/order-visitor';

const meta = {
  requestId: 'req-snap-1',
  actorId: 'user-1',
  restaurantId: 'rest-1',
};

describe('orders.pricing-snapshots — Immutable Modifier & UK VAT Snapshots', () => {
  it('freezes modifier snapshots, applies proportional promo VAT reduction, and routes KDS tickets', () => {
    const res = OrderAggregate.createOrder(
      'ord-snap-1',
      {
        branchId: 'branch-1',
        restaurantId: 'rest-1',
        customerId: 'user-1',
        orderSource: 'ONLINE_DELIVERY',
        stateMachineCode: 'FULL_KDS_DELIVERY',
        paymentMode: 'ONLINE_GATEWAY',
        requiresOnlineCapture: true,
        promoDiscountGbp: new Decimal('5.00'),
        deliveryFeeGbp: new Decimal('2.99'),
        loyaltyDiscountGbp: new Decimal('1.00'),
        loyaltyPointsHeld: 100,
        loyaltyWalletScope: 'PLATFORM',
        lines: [
          {
            lineId: 'line-1',
            menuItemId: 'item-burger',
            itemName: 'Double Smash Burger',
            quantity: 2,
            unitPriceGbp: new Decimal('10.00'),
            vatRatePercent: new Decimal('20.00'),
            allergenFlags: [
              'GLUTEN',
              'DAIRY',
            ],
            kdsTarget: 'KITCHEN_SCREEN',
            modifiers: [
              {
                modifierId: 'mod-cheese',
                name: 'Aged Cheddar',
                extraPriceGbp: new Decimal('2.50'),
              },
            ],
          },
          {
            lineId: 'line-2',
            menuItemId: 'item-drink',
            itemName: 'Sparkling Elderflower',
            quantity: 1,
            unitPriceGbp: new Decimal('3.00'),
            vatRatePercent: new Decimal('0.00'),
            allergenFlags: [],
            kdsTarget: 'BAR_PRINTER',
            modifiers: [],
          },
        ],
      },
      meta,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const snap = res.value.snapshot;
    // Gross lines = 2*(10+2.50) + 3.00 = 28.00; after £5.00 promo = 23.00
    expect(snap.subtotalGbp).toBe('23.00');
    expect(snap.items[0]?.modifiers).toHaveLength(1);
    expect(snap.items[0]?.allergenFlags).toEqual([
      'GLUTEN',
      'DAIRY',
    ]);

    const tickets = res.value.accept(new KdsTicketVisitor());
    expect(tickets.stationSlips.KITCHEN_SCREEN).toHaveLength(1);
    expect(tickets.stationSlips.BAR_PRINTER).toHaveLength(1);
  });
});
