import { describe, expect, it } from 'vitest';
import { resolveOrderStateMachine } from '@/orders/domain/order-state-machines';

describe('orders.state-machines — Named System Lifecycle Machines', () => {
  it('enforces FULL_KDS_DELIVERY transitions and blocks skipped or post-dispatch cancels', () => {
    const sm = resolveOrderStateMachine('FULL_KDS_DELIVERY');

    expect(sm.validateTransition('PLACED', 'ACCEPTED').ok).toBe(true);
    expect(sm.validateTransition('ACCEPTED', 'PREPARING').ok).toBe(true);
    expect(sm.validateTransition('PREPARING', 'PACKING').ok).toBe(true);
    expect(sm.validateTransition('PACKING', 'READY_FOR_PICKUP').ok).toBe(true);
    expect(sm.validateTransition('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY').ok).toBe(true);
    expect(sm.validateTransition('OUT_FOR_DELIVERY', 'COMPLETED').ok).toBe(true);

    expect(sm.validateTransition('PLACED', 'COMPLETED').ok).toBe(false);
    expect(sm.validateTransition('OUT_FOR_DELIVERY', 'CANCELLED').ok).toBe(false);
    expect(sm.getAllowedNextStatuses('COMPLETED')).toEqual([]);
  });

  it('enforces HOME_KITCHEN_SIMPLE direct acceptance-to-fulfillment transitions', () => {
    const sm = resolveOrderStateMachine('HOME_KITCHEN_SIMPLE');

    expect(sm.validateTransition('PLACED', 'ACCEPTED').ok).toBe(true);
    expect(sm.validateTransition('ACCEPTED', 'READY_FOR_PICKUP').ok).toBe(true);
    expect(sm.validateTransition('READY_FOR_PICKUP', 'COMPLETED').ok).toBe(true);
    expect(sm.validateTransition('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY').ok).toBe(false);
  });

  it('enforces STANDARD_RESTAURANT transitions and cancel windows', () => {
    const sm = resolveOrderStateMachine('STANDARD_RESTAURANT');

    expect(sm.validateTransition('PLACED', 'ACCEPTED').ok).toBe(true);
    expect(sm.validateTransition('ACCEPTED', 'PREPARING').ok).toBe(true);
    expect(sm.validateTransition('PREPARING', 'COMPLETED').ok).toBe(true);
    expect(sm.validateTransition('PLACED', 'CANCELLED').ok).toBe(true);
    expect(sm.validateTransition('COMPLETED', 'CANCELLED').ok).toBe(false);
  });
});
