import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { OrderStateMachineCode, OrderStatus } from '@/orders/domain/order-events';

const TERMINAL_STATUSES = new Set<OrderStatus>([
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
]);

const CANCEL_ALLOWED_FROM = new Set<OrderStatus>([
  'PENDING_PAYMENT',
  'PLACED',
  'ACCEPTED',
  'PREPARING',
]);

const REJECT_ALLOWED_FROM = new Set<OrderStatus>([
  'PENDING_PAYMENT',
  'PLACED',
]);

const MACHINE_TRANSITIONS: Record<
  OrderStateMachineCode,
  Partial<Record<OrderStatus, readonly OrderStatus[]>>
> = {
  HOME_KITCHEN_SIMPLE: {
    PENDING_PAYMENT: [
      'PLACED',
    ],
    PLACED: [
      'ACCEPTED',
    ],
    ACCEPTED: [
      'READY_FOR_PICKUP',
      'OUT_FOR_DELIVERY',
      'COMPLETED',
    ],
    READY_FOR_PICKUP: [
      'COMPLETED',
    ],
    OUT_FOR_DELIVERY: [
      'COMPLETED',
    ],
  },
  STANDARD_RESTAURANT: {
    PENDING_PAYMENT: [
      'PLACED',
    ],
    PLACED: [
      'ACCEPTED',
    ],
    ACCEPTED: [
      'PREPARING',
    ],
    PREPARING: [
      'READY_FOR_PICKUP',
      'OUT_FOR_DELIVERY',
      'COMPLETED',
    ],
    READY_FOR_PICKUP: [
      'OUT_FOR_DELIVERY',
      'COMPLETED',
    ],
    OUT_FOR_DELIVERY: [
      'COMPLETED',
    ],
  },
  FULL_KDS_DELIVERY: {
    PENDING_PAYMENT: [
      'PLACED',
    ],
    PLACED: [
      'ACCEPTED',
    ],
    ACCEPTED: [
      'PREPARING',
    ],
    PREPARING: [
      'PACKING',
    ],
    PACKING: [
      'READY_FOR_PICKUP',
    ],
    READY_FOR_PICKUP: [
      'OUT_FOR_DELIVERY',
      'COMPLETED',
    ],
    OUT_FOR_DELIVERY: [
      'COMPLETED',
    ],
  },
};

export interface OrderStateMachine {
  readonly code: OrderStateMachineCode;
  validateTransition(from: OrderStatus, to: OrderStatus): Result<void>;
  getAllowedNextStatuses(current: OrderStatus): readonly OrderStatus[];
}

class NamedOrderStateMachine implements OrderStateMachine {
  public readonly code: OrderStateMachineCode;

  constructor(code: OrderStateMachineCode) {
    this.code = code;
  }

  validateTransition(from: OrderStatus, to: OrderStatus): Result<void> {
    if (TERMINAL_STATUSES.has(from)) {
      return err(
        new DomainError(
          'ORDER_TERMINAL_STATE',
          `Order is locked in terminal status ${from} and cannot transition to ${to}.`,
          409,
        ),
      );
    }

    if (to === 'CANCELLED') {
      if (!CANCEL_ALLOWED_FROM.has(from)) {
        return err(
          new DomainError(
            'CANCEL_WINDOW_CLOSED',
            `Cannot cancel order once it has reached ${from}.`,
            409,
          ),
        );
      }
      return ok(undefined);
    }

    if (to === 'REJECTED') {
      if (!REJECT_ALLOWED_FROM.has(from)) {
        return err(
          new DomainError(
            'REJECT_WINDOW_CLOSED',
            `Cannot reject order once it has reached ${from}.`,
            409,
          ),
        );
      }
      return ok(undefined);
    }

    const allowed = MACHINE_TRANSITIONS[this.code][from] ?? [];
    if (!allowed.includes(to)) {
      return err(
        new DomainError(
          'INVALID_ORDER_TRANSITION',
          `Transition ${from} -> ${to} is not permitted on ${this.code} workflow.`,
          400,
        ),
      );
    }

    return ok(undefined);
  }

  getAllowedNextStatuses(current: OrderStatus): readonly OrderStatus[] {
    if (TERMINAL_STATUSES.has(current)) return [];
    const next: OrderStatus[] = [
      ...(MACHINE_TRANSITIONS[this.code][current] ?? []),
    ];
    if (CANCEL_ALLOWED_FROM.has(current)) next.push('CANCELLED');
    if (REJECT_ALLOWED_FROM.has(current)) next.push('REJECTED');
    return next;
  }
}

export function resolveOrderStateMachine(code: OrderStateMachineCode): OrderStateMachine {
  return new NamedOrderStateMachine(code);
}
