import type { InStorePaymentMethod, KdsRoutingTarget, OrderSource } from '@foodapp/db';
import { AggregateRoot } from '@/core/domain/aggregate-root';
import type { DomainEvent, EventMetadata } from '@/core/domain/domain-event';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { Visitable } from '@/core/patterns/visitor';
import type {
  KitchenTicketRequestedPayload,
  LoyaltyPointsEligiblePayload,
  OrderLineSnapshot,
  PosOrderPlacedPayload,
  PosOrderSettledPayload,
} from '@/ordering/domain/order-events';
import { type OrderLifecycleStatus, resolveOrderState } from '@/ordering/domain/order-state';
import type { OrderVisitor } from '@/ordering/domain/order-visitor';

export interface OrderAggregateState {
  restaurantId: string;
  diningTableId?: string;
  customerId?: string;
  orderSource: OrderSource;
  status: OrderLifecycleStatus;
  paymentMethod?: InStorePaymentMethod;
  items: OrderLineSnapshot[];
  subtotal: number;
  vatTotal: number;
  tipAmount: number;
  totalAmount: number;
}

const INITIAL_STATE: OrderAggregateState = {
  restaurantId: '',
  orderSource: 'DINE_IN',
  status: 'PLACED',
  items: [],
  subtotal: 0,
  vatTotal: 0,
  tipAmount: 0,
  totalAmount: 0,
};

export class OrderAggregate
  extends AggregateRoot<OrderAggregateState>
  implements Visitable<OrderVisitor<unknown>, unknown>
{
  private constructor(id: string, state: OrderAggregateState = structuredClone(INITIAL_STATE)) {
    super(id, 'OrderAggregate', state);
  }

  /**
   * GoF Factory: Rehydrates an empty aggregate before loading Memento + Event Stream
   */
  public static empty(id: string): OrderAggregate {
    return new OrderAggregate(id);
  }

  /**
   * Domain Action 1: Places a new POS Order and raises 2 events:
   * - PosOrderPlaced (mutates aggregate state)
   * - KitchenTicketRequested (informational event for KDS/Bar printers, zero state mutation)
   */
  public static place(
    id: string,
    params: {
      restaurantId: string;
      diningTableId?: string;
      customerId?: string;
      orderSource: OrderSource;
      items: readonly OrderLineSnapshot[];
    },
    metadata: EventMetadata,
  ): Result<OrderAggregate> {
    if (params.items.length === 0) {
      return err(new DomainError('EMPTY_ORDER', 'Cannot place an order with zero items.'));
    }

    let subtotal = 0;
    let vatTotal = 0;

    for (const item of params.items) {
      const modsTotal = item.modifiers.reduce((sum, m) => sum + m.extraPrice, 0);
      const lineNet = (item.unitPrice + modsTotal) * item.quantity;
      const lineVat = lineNet * (item.vatRate / 100);
      subtotal += lineNet;
      vatTotal += lineVat;
    }

    subtotal = Number(subtotal.toFixed(2));
    vatTotal = Number(vatTotal.toFixed(2));
    const totalAmount = Number((subtotal + vatTotal).toFixed(2));

    const order = new OrderAggregate(id);

    order.raiseEvent<PosOrderPlacedPayload>(
      'PosOrderPlaced',
      {
        restaurantId: params.restaurantId,
        diningTableId: params.diningTableId,
        customerId: params.customerId,
        orderSource: params.orderSource,
        items: params.items,
        subtotal,
        vatTotal,
        totalAmount,
      },
      metadata,
    );

    // Group items by KDS/Printer routing target for the informational event
    const grouped: Record<KdsRoutingTarget, OrderLineSnapshot[]> = {
      KITCHEN_SCREEN: [],
      BAR_PRINTER: [],
      PASTRY_STATION: [],
    };
    for (const item of params.items) {
      grouped[item.kdsTarget].push(item);
    }

    order.raiseEvent<KitchenTicketRequestedPayload>(
      'KitchenTicketRequested',
      {
        restaurantId: params.restaurantId,
        diningTableId: params.diningTableId,
        ticketsByStation: grouped,
      },
      metadata,
    );

    return ok(order);
  }

  /**
   * Domain Action 2: Settles the POS bill using GoF State Pattern validation.
   * Raises PosOrderSettled + optional LoyaltyPointsEligible event.
   */
  public settleBill(
    paymentMethod: InStorePaymentMethod,
    tipAmount: number,
    metadata: EventMetadata,
  ): Result<void> {
    const currentState = resolveOrderState(this.state.status);
    const transition = currentState.canSettle();
    if (!transition.ok) {
      return transition;
    }

    const cleanTip = Number(Math.max(0, tipAmount).toFixed(2));
    const finalTotal = Number((this.state.totalAmount + cleanTip).toFixed(2));

    this.raiseEvent<PosOrderSettledPayload>(
      'PosOrderSettled',
      {
        restaurantId: this.state.restaurantId,
        paymentMethod,
        subtotal: this.state.subtotal,
        vatTotal: this.state.vatTotal,
        tipAmount: cleanTip,
        finalTotal,
      },
      metadata,
    );

    if (this.state.customerId) {
      this.raiseEvent<LoyaltyPointsEligiblePayload>(
        'LoyaltyPointsEligible',
        {
          customerId: this.state.customerId,
          restaurantId: this.state.restaurantId,
          pointsEarned: Math.floor(this.state.subtotal * 10), // 10 points per £1 spent
        },
        metadata,
      );
    }

    return ok(undefined);
  }

  protected apply(event: DomainEvent): void {
    switch (event.eventType) {
      case 'PosOrderPlaced': {
        const p = event.payload as unknown as PosOrderPlacedPayload;
        this.state.restaurantId = p.restaurantId;
        this.state.diningTableId = p.diningTableId;
        this.state.customerId = p.customerId;
        this.state.orderSource = p.orderSource;
        this.state.items = [
          ...p.items,
        ];
        this.state.subtotal = p.subtotal;
        this.state.vatTotal = p.vatTotal;
        this.state.totalAmount = p.totalAmount;
        this.state.status = 'PLACED';
        break;
      }
      case 'PosOrderSettled': {
        const p = event.payload as unknown as PosOrderSettledPayload;
        this.state.paymentMethod = p.paymentMethod;
        this.state.tipAmount = p.tipAmount;
        this.state.totalAmount = p.finalTotal;
        this.state.status = 'SETTLED';
        break;
      }
      case 'KitchenTicketRequested':
      case 'LoyaltyPointsEligible':
        // Pure informational / integration events: zero mutation on OrderAggregate
        break;
    }
  }

  public get snapshot(): Readonly<OrderAggregateState> {
    return this.state;
  }

  public shouldTakeMemento(): boolean {
    // Checkpoint every 5 events to keep rehydration instant
    return this._version > 0 && this._version % 5 === 0;
  }

  public accept<TResult>(visitor: OrderVisitor<TResult>): TResult {
    return visitor.visitOrder({
      id: this.id,
      restaurantId: this.state.restaurantId,
      diningTableId: this.state.diningTableId,
      items: this.state.items,
      subtotal: this.state.subtotal,
      vatTotal: this.state.vatTotal,
      totalAmount: this.state.totalAmount,
    });
  }
}
