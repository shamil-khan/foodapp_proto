import { DomainError, err, ok, type Result } from '@/core/domain/result';

export type OrderLifecycleStatus = 'PLACED' | 'FOOD_PREPARING' | 'SERVED' | 'SETTLED' | 'CANCELLED';

export interface OrderLifecycleState {
  readonly status: OrderLifecycleStatus;
  canStartPreparing(): Result<OrderLifecycleState>;
  canMarkServed(): Result<OrderLifecycleState>;
  canSettle(): Result<OrderLifecycleState>;
}

class PlacedState implements OrderLifecycleState {
  readonly status = 'PLACED' as const;

  canStartPreparing(): Result<OrderLifecycleState> {
    return ok(new PreparingState());
  }

  canMarkServed(): Result<OrderLifecycleState> {
    return err(new DomainError('INVALID_TRANSITION', 'Order must be prepared before serving.'));
  }

  canSettle(): Result<OrderLifecycleState> {
    // Counter takeaway / quick POS orders can settle immediately after placement
    return ok(new SettledState());
  }
}

class PreparingState implements OrderLifecycleState {
  readonly status = 'FOOD_PREPARING' as const;

  canStartPreparing(): Result<OrderLifecycleState> {
    return err(new DomainError('ALREADY_PREPARING', 'Kitchen is already preparing this order.'));
  }

  canMarkServed(): Result<OrderLifecycleState> {
    return ok(new ServedState());
  }

  canSettle(): Result<OrderLifecycleState> {
    return ok(new SettledState());
  }
}

class ServedState implements OrderLifecycleState {
  readonly status = 'SERVED' as const;

  canStartPreparing(): Result<OrderLifecycleState> {
    return err(new DomainError('ALREADY_SERVED', 'Order has already been served.'));
  }

  canMarkServed(): Result<OrderLifecycleState> {
    return err(new DomainError('ALREADY_SERVED', 'Order is already marked as served.'));
  }

  canSettle(): Result<OrderLifecycleState> {
    return ok(new SettledState());
  }
}

class SettledState implements OrderLifecycleState {
  readonly status = 'SETTLED' as const;

  canStartPreparing(): Result<OrderLifecycleState> {
    return err(new DomainError('ORDER_LOCKED', 'Settled orders cannot be modified.'));
  }

  canMarkServed(): Result<OrderLifecycleState> {
    return err(new DomainError('ORDER_LOCKED', 'Settled orders cannot be modified.'));
  }

  canSettle(): Result<OrderLifecycleState> {
    return err(new DomainError('ALREADY_SETTLED', 'Order bill has already been settled.'));
  }
}

export function resolveOrderState(status: OrderLifecycleStatus): OrderLifecycleState {
  switch (status) {
    case 'PLACED':
      return new PlacedState();
    case 'FOOD_PREPARING':
      return new PreparingState();
    case 'SERVED':
      return new ServedState();
    case 'SETTLED':
      return new SettledState();
    default:
      return new SettledState();
  }
}
