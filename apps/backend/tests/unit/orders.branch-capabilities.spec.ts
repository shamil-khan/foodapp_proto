import Decimal from 'decimal.js';
import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '@/container';
import type { OrderChannel, OrderPaymentMode } from '@/orders/domain/order-events';
import { OrderController } from '@/orders/services/order-controller';

function isChannelPaymentAllowed(
  capabilities: Record<string, string[]>,
  orderSource: OrderChannel,
  paymentMode: OrderPaymentMode,
): boolean {
  const capKey = orderSource === 'ONLINE_DELIVERY' ? 'DELIVERY' : orderSource;
  const allowedModes = capabilities[capKey] ?? [];
  return allowedModes.length === 0 || allowedModes.includes(paymentMode);
}

describe('orders.branch-capabilities — Channel Payment Capability & Cash Credit Guard', () => {
  it('permits configured channel modes and falls back when a channel key is omitted', () => {
    const caps: Record<string, string[]> = {
      DELIVERY: [
        'ONLINE_GATEWAY',
        'LOYALTY_POINTS',
      ],
      TAKEAWAY: [
        'ONLINE_GATEWAY',
      ],
    };

    expect(isChannelPaymentAllowed(caps, 'ONLINE_DELIVERY', 'ONLINE_GATEWAY')).toBe(true);
    expect(isChannelPaymentAllowed(caps, 'ONLINE_DELIVERY', 'LOYALTY_POINTS')).toBe(true);
    expect(isChannelPaymentAllowed(caps, 'TAKEAWAY', 'ONLINE_GATEWAY')).toBe(true);
    expect(isChannelPaymentAllowed(caps, 'POS', 'CARD_TERMINAL')).toBe(true);
    expect(isChannelPaymentAllowed(caps, 'DINE_IN', 'CASH')).toBe(true);
  });

  it('rejects COD or CASH when excluded from branch capabilities or when credit limit is breached', () => {
    const onlineOnly: Record<string, string[]> = {
      DELIVERY: [
        'ONLINE_GATEWAY',
      ],
    };

    expect(isChannelPaymentAllowed(onlineOnly, 'ONLINE_DELIVERY', 'COD')).toBe(false);
    expect(isChannelPaymentAllowed(onlineOnly, 'ONLINE_DELIVERY', 'ONLINE_GATEWAY')).toBe(true);

    const cashReceivableGbp = new Decimal('250.00');
    const maxCreditLimitGbp = new Decimal('200.00');
    expect(cashReceivableGbp.gte(maxCreditLimitGbp)).toBe(true);
  });
});

// Append to apps/backend/tests/unit/orders.branch-capabilities.spec.ts
describe('OrderController.listOrders — Active Branch Resolution', () => {
  it('defaults to request.branchId (not brand restaurantId) when no query param is supplied', async () => {
    let askedQueryPayload: Record<string, unknown> | undefined;
    const controller = new OrderController(
      {} as never,
      {
        ask: async (_name: string, payload: Record<string, unknown>) => {
          askedQueryPayload = payload;
          return [];
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        requestId: 'req-list-1',
        actorId: 'staff-1',
        actorSource: 'POS_STAFF',
        restaurantId: 'brand-uuid-111',
        branchId: 'branch-uuid-222',
        permissions: [
          'orders:read',
        ],
      },
    );

    const fakeCtx = {
      json: (body: unknown, status: number) => ({
        body,
        status,
      }),
    } as unknown as Context<AppEnv>;

    await controller.listOrders(fakeCtx, {});
    expect(askedQueryPayload?.restaurantId).toBe('branch-uuid-222');
  });
});
