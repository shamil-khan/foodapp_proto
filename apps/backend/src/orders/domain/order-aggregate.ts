import type { KdsRoutingTarget } from '@foodapp/db';
import Decimal from 'decimal.js';
import { AggregateRoot } from '@/core/domain/aggregate-root';
import type { DomainEvent, EventMetadata } from '@/core/domain/domain-event';
import { allocateLineVatWithRemainder, formatGbp, money, roundGbp } from '@/core/domain/money';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { Visitable } from '@/core/patterns/visitor';
import type {
  KitchenTicketRequestedPayload,
  OrderCancelledOrRejectedPayload,
  OrderChannel,
  OrderItemModifierSnapshot,
  OrderLineSnapshot,
  OrderLoyaltyScope,
  OrderPaymentMode,
  OrderPlacedPayload,
  OrderSettledPayload,
  OrderStateMachineCode,
  OrderStatus,
  OrderTransitionedPayload,
} from '@/orders/domain/order-events';
import { resolveOrderStateMachine } from '@/orders/domain/order-state-machines';
import type { OrderVisitor } from '@/orders/domain/order-visitor';

export interface HydratedCartLineInput {
  readonly lineId: string;
  readonly menuItemId: string;
  readonly itemName: string;
  readonly quantity: number;
  readonly unitPriceGbp: Decimal;
  readonly vatRatePercent: Decimal;
  readonly allergenFlags: readonly string[];
  readonly kdsTarget: KdsRoutingTarget;
  readonly modifiers: readonly {
    readonly modifierId: string;
    readonly name: string;
    readonly extraPriceGbp: Decimal;
  }[];
}

export interface OrderAggregateState {
  branchId: string;
  restaurantId: string;
  customerId?: string;
  diningTableId?: string;
  orderSource: OrderChannel;
  status: OrderStatus;
  stateMachineCode: OrderStateMachineCode;
  paymentMode: OrderPaymentMode;
  isPaid: boolean;
  gatewayReference?: string;
  idempotencyKey?: string;
  posTerminalId?: string;
  posReceiptNumber?: string;
  occurredAt: string;
  syncedAt?: string;
  items: OrderLineSnapshot[];
  subtotalGbp: string;
  vatTotalGbp: string;
  deliveryFeeGbp: string;
  tipAmountGbp: string;
  loyaltyPointsHeld: number;
  loyaltyWalletScope?: OrderLoyaltyScope;
  loyaltyDiscountGbp: string;
  totalAmountGbp: string;
  allowLoyaltyEarn: boolean;
  allowLoyaltyRedeem: boolean;
  deliveryProviderCode?: string;
  externalDeliveryId?: string;
  providerPayloadSnapshot?: Record<string, unknown>;
}

const INITIAL_ORDER_STATE: OrderAggregateState = {
  branchId: '',
  restaurantId: '',
  orderSource: 'DINE_IN',
  status: 'PLACED',
  stateMachineCode: 'STANDARD_RESTAURANT',
  paymentMode: 'CARD_TERMINAL',
  isPaid: false,
  occurredAt: new Date(0).toISOString(),
  items: [],
  subtotalGbp: '0.00',
  vatTotalGbp: '0.00',
  deliveryFeeGbp: '0.00',
  tipAmountGbp: '0.00',
  loyaltyPointsHeld: 0,
  loyaltyDiscountGbp: '0.00',
  totalAmountGbp: '0.00',
  allowLoyaltyEarn: true,
  allowLoyaltyRedeem: true,
};

export function computeAuthoritativeLineSnapshots(params: {
  readonly lines: readonly HydratedCartLineInput[];
  readonly promoDiscountGbp?: Decimal;
  readonly deliveryFeeGbp?: Decimal;
  readonly loyaltyDiscountGbp?: Decimal;
}): {
  readonly items: OrderLineSnapshot[];
  readonly subtotalGbp: Decimal;
  readonly vatTotalGbp: Decimal;
  readonly deliveryFeeGbp: Decimal;
  readonly loyaltyDiscountGbp: Decimal;
  readonly totalAmountGbp: Decimal;
} {
  const preDiscountLines = params.lines.map((line) => {
    const modSum = line.modifiers.reduce(
      (acc, m) => acc.plus(roundGbp(m.extraPriceGbp)),
      new Decimal(0),
    );
    const unitWithMods = roundGbp(line.unitPriceGbp.plus(modSum));
    const lineNet = roundGbp(unitWithMods.mul(line.quantity));
    return {
      raw: line,
      lineNet,
    };
  });

  const grossFoodNet = roundGbp(
    preDiscountLines.reduce((acc, l) => acc.plus(l.lineNet), new Decimal(0)),
  );
  const promoDiscount = roundGbp(
    Decimal.min(grossFoodNet, Decimal.max(0, params.promoDiscountGbp ?? new Decimal(0))),
  );

  // Allocate promo discount proportionally across lines so mixed 0%/20% UK VAT rates stay exact
  let remainingDiscount = promoDiscount;
  const discountedLines = preDiscountLines.map((entry, idx) => {
    if (promoDiscount.isZero() || grossFoodNet.isZero()) {
      return {
        ...entry,
        netAfterPromo: entry.lineNet,
      };
    }
    if (idx === preDiscountLines.length - 1) {
      return {
        ...entry,
        netAfterPromo: roundGbp(Decimal.max(0, entry.lineNet.minus(remainingDiscount))),
      };
    }
    const share = roundGbp(promoDiscount.mul(entry.lineNet).div(grossFoodNet));
    remainingDiscount = roundGbp(remainingDiscount.minus(share));
    return {
      ...entry,
      netAfterPromo: roundGbp(Decimal.max(0, entry.lineNet.minus(share))),
    };
  });

  const vatAllocated = allocateLineVatWithRemainder(
    discountedLines.map((l) => ({
      lineId: l.raw.lineId,
      netAmount: l.netAfterPromo,
      vatRatePercent: l.raw.vatRatePercent,
    })),
  );
  const vatByLineId = new Map(
    vatAllocated.lines.map((v) => [
      v.lineId,
      v,
    ]),
  );

  const items: OrderLineSnapshot[] = discountedLines.map((entry) => {
    const vatLine = vatByLineId.get(entry.raw.lineId);
    const modifiers: OrderItemModifierSnapshot[] = entry.raw.modifiers.map((m) => ({
      modifierId: m.modifierId,
      name: m.name,
      extraPriceGbp: formatGbp(m.extraPriceGbp),
    }));

    return {
      lineId: entry.raw.lineId,
      menuItemId: entry.raw.menuItemId,
      itemName: entry.raw.itemName,
      quantity: entry.raw.quantity,
      unitPriceGbp: formatGbp(entry.raw.unitPriceGbp),
      vatRatePercent: entry.raw.vatRatePercent.toFixed(2),
      vatAmountGbp: formatGbp(vatLine?.vatAmount ?? 0),
      allergenFlags: [
        ...entry.raw.allergenFlags,
      ],
      kdsTarget: entry.raw.kdsTarget,
      modifiers,
    };
  });

  const deliveryFee = roundGbp(params.deliveryFeeGbp ?? new Decimal(0));
  const preLoyaltyTotal = roundGbp(
    vatAllocated.totalNet.plus(vatAllocated.totalVat).plus(deliveryFee),
  );
  const loyaltyDiscount = roundGbp(
    Decimal.min(preLoyaltyTotal, Decimal.max(0, params.loyaltyDiscountGbp ?? new Decimal(0))),
  );
  const totalAmount = roundGbp(preLoyaltyTotal.minus(loyaltyDiscount));

  return {
    items,
    subtotalGbp: vatAllocated.totalNet,
    vatTotalGbp: vatAllocated.totalVat,
    deliveryFeeGbp: deliveryFee,
    loyaltyDiscountGbp: loyaltyDiscount,
    totalAmountGbp: totalAmount,
  };
}

export class OrderAggregate
  extends AggregateRoot<OrderAggregateState>
  implements Visitable<OrderVisitor<unknown>, unknown>
{
  private constructor(
    id: string,
    state: OrderAggregateState = structuredClone(INITIAL_ORDER_STATE),
  ) {
    super(id, 'OrderAggregate', state);
  }

  public static empty(id: string): OrderAggregate {
    return new OrderAggregate(id);
  }

  public static fromSnapshot(
    id: string,
    state: OrderAggregateState,
    version: number,
  ): OrderAggregate {
    const agg = new OrderAggregate(id, structuredClone(state));
    agg._version = version;
    return agg;
  }

  public static createOrder(
    id: string,
    params: {
      readonly branchId: string;
      readonly restaurantId: string;
      readonly customerId?: string;
      readonly diningTableId?: string;
      readonly orderSource: OrderChannel;
      readonly stateMachineCode: OrderStateMachineCode;
      readonly paymentMode: OrderPaymentMode;
      readonly requiresOnlineCapture: boolean;
      readonly idempotencyKey?: string;
      readonly posTerminalId?: string;
      readonly posReceiptNumber?: string;
      readonly occurredAt?: Date;
      readonly syncedAt?: Date;
      readonly lines: readonly HydratedCartLineInput[];
      readonly promoDiscountGbp?: Decimal;
      readonly deliveryFeeGbp?: Decimal;
      readonly loyaltyPointsHeld?: number;
      readonly loyaltyWalletScope?: OrderLoyaltyScope;
      readonly loyaltyDiscountGbp?: Decimal;
      readonly allowLoyaltyEarn?: boolean;
      readonly allowLoyaltyRedeem?: boolean;
    },
    metadata: EventMetadata,
  ): Result<OrderAggregate> {
    if (params.lines.length === 0) {
      return err(new DomainError('EMPTY_ORDER', 'Cannot create an order with zero items.', 400));
    }
    for (const line of params.lines) {
      if (line.quantity <= 0 || !Number.isInteger(line.quantity)) {
        return err(
          new DomainError('INVALID_QUANTITY', 'Item quantity must be a positive integer.', 400),
        );
      }
    }

    const totals = computeAuthoritativeLineSnapshots({
      lines: params.lines,
      promoDiscountGbp: params.promoDiscountGbp,
      deliveryFeeGbp: params.deliveryFeeGbp,
      loyaltyDiscountGbp: params.loyaltyDiscountGbp,
    });

    const initialStatus: OrderStatus = params.requiresOnlineCapture ? 'PENDING_PAYMENT' : 'PLACED';
    const order = new OrderAggregate(id);
    order.raiseEvent<OrderPlacedPayload>(
      'OrderPlaced',
      {
        orderId: id,
        branchId: params.branchId,
        restaurantId: params.restaurantId,
        customerId: params.customerId,
        diningTableId: params.diningTableId,
        orderSource: params.orderSource,
        initialStatus,
        stateMachineCode: params.stateMachineCode,
        paymentMode: params.paymentMode,
        idempotencyKey: params.idempotencyKey,
        posTerminalId: params.posTerminalId,
        posReceiptNumber: params.posReceiptNumber,
        occurredAt: (params.occurredAt ?? new Date()).toISOString(),
        syncedAt: params.syncedAt?.toISOString(),
        items: totals.items,
        subtotalGbp: formatGbp(totals.subtotalGbp),
        vatTotalGbp: formatGbp(totals.vatTotalGbp),
        deliveryFeeGbp: formatGbp(totals.deliveryFeeGbp),
        loyaltyPointsHeld: params.loyaltyPointsHeld ?? 0,
        loyaltyWalletScope: params.loyaltyWalletScope,
        loyaltyDiscountGbp: formatGbp(totals.loyaltyDiscountGbp),
        totalAmountGbp: formatGbp(totals.totalAmountGbp),
        allowLoyaltyEarn: params.allowLoyaltyEarn ?? true,
        allowLoyaltyRedeem: params.allowLoyaltyRedeem ?? true,
      },
      metadata,
    );

    if (initialStatus === 'PLACED') {
      order.emitKdsTickets(metadata);
    }

    return ok(order);
  }

  private emitKdsTickets(metadata: EventMetadata): void {
    const grouped: Record<KdsRoutingTarget, OrderLineSnapshot[]> = {
      KITCHEN_SCREEN: [],
      BAR_PRINTER: [],
      PASTRY_STATION: [],
    };
    for (const item of this.state.items) {
      grouped[item.kdsTarget].push(item);
    }

    this.raiseEvent<KitchenTicketRequestedPayload>(
      'KitchenTicketRequested',
      {
        orderId: this.id,
        branchId: this.state.branchId,
        diningTableId: this.state.diningTableId,
        ticketsByStation: grouped,
      },
      metadata,
    );
  }

  public confirmOnlinePaymentCaptured(
    gatewayReference: string,
    metadata: EventMetadata,
  ): Result<void> {
    if (this.state.status !== 'PENDING_PAYMENT') {
      return err(
        new DomainError(
          'INVALID_ORDER_TRANSITION',
          `Cannot capture payment while order is in status ${this.state.status}.`,
          409,
        ),
      );
    }

    this.raiseEvent<OrderTransitionedPayload>(
      'OrderTransitioned',
      {
        orderId: this.id,
        branchId: this.state.branchId,
        restaurantId: this.state.restaurantId,
        customerId: this.state.customerId,
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'PLACED',
        reason: 'Online gateway payment captured',
      },
      metadata,
    );

    this.emitKdsTickets(metadata);

    this.raiseEvent<OrderSettledPayload>(
      'OrderSettled',
      {
        orderId: this.id,
        branchId: this.state.branchId,
        restaurantId: this.state.restaurantId,
        customerId: this.state.customerId,
        paymentMode: this.state.paymentMode,
        gatewayReference,
        subtotalGbp: this.state.subtotalGbp,
        vatTotalGbp: this.state.vatTotalGbp,
        deliveryFeeGbp: this.state.deliveryFeeGbp,
        tipAmountGbp: '0.00',
        loyaltyDiscountGbp: this.state.loyaltyDiscountGbp,
        finalTotalGbp: this.state.totalAmountGbp,
        allowLoyaltyEarn: this.state.allowLoyaltyEarn,
      },
      metadata,
    );

    return ok(undefined);
  }

  public transitionTo(
    toStatus: OrderStatus,
    options: {
      readonly expectedRowVersion?: number;
      readonly reason?: string;
      readonly deliveryProviderCode?: string;
      readonly externalDeliveryId?: string;
      readonly providerPayloadSnapshot?: Record<string, unknown>;
    },
    metadata: EventMetadata,
  ): Result<void> {
    if (options.expectedRowVersion !== undefined && this._version !== options.expectedRowVersion) {
      return err(
        new DomainError(
          'CONCURRENCY_CONFLICT',
          `Order version mismatch: expected ${options.expectedRowVersion}, actual ${this._version}.`,
          409,
        ),
      );
    }

    if (toStatus === 'CANCELLED' || toStatus === 'REJECTED') {
      return this.cancelOrReject(toStatus, options.reason ?? 'Cancelled by actor', metadata);
    }

    const machine = resolveOrderStateMachine(this.state.stateMachineCode);
    const valid = machine.validateTransition(this.state.status, toStatus);
    if (!valid.ok) return valid;

    this.raiseEvent<OrderTransitionedPayload>(
      'OrderTransitioned',
      {
        orderId: this.id,
        branchId: this.state.branchId,
        restaurantId: this.state.restaurantId,
        customerId: this.state.customerId,
        fromStatus: this.state.status,
        toStatus,
        reason: options.reason,
        deliveryProviderCode: options.deliveryProviderCode,
        externalDeliveryId: options.externalDeliveryId,
        providerPayloadSnapshot: options.providerPayloadSnapshot,
      },
      metadata,
    );

    return ok(undefined);
  }

  public settleBill(
    params: {
      readonly paymentMode: OrderPaymentMode;
      readonly tipAmountGbp?: Decimal;
      readonly gatewayReference?: string;
      readonly expectedRowVersion?: number;
    },
    metadata: EventMetadata,
  ): Result<void> {
    if (params.expectedRowVersion !== undefined && this._version !== params.expectedRowVersion) {
      return err(
        new DomainError(
          'CONCURRENCY_CONFLICT',
          `Order version mismatch: expected ${params.expectedRowVersion}, actual ${this._version}.`,
          409,
        ),
      );
    }

    if (this.state.isPaid) {
      return err(new DomainError('ALREADY_SETTLED', 'Order bill has already been settled.', 400));
    }

    if (this.state.status === 'CANCELLED' || this.state.status === 'REJECTED') {
      return err(
        new DomainError(
          'ORDER_TERMINAL_STATE',
          `Cannot settle order in ${this.state.status} status.`,
          409,
        ),
      );
    }

    const cleanTip = roundGbp(Decimal.max(0, params.tipAmountGbp ?? new Decimal(0)));
    const finalTotal = roundGbp(money(this.state.totalAmountGbp).plus(cleanTip));

    if (this.state.status !== 'COMPLETED') {
      this.raiseEvent<OrderTransitionedPayload>(
        'OrderTransitioned',
        {
          orderId: this.id,
          branchId: this.state.branchId,
          restaurantId: this.state.restaurantId,
          customerId: this.state.customerId,
          fromStatus: this.state.status,
          toStatus: 'COMPLETED',
          reason: 'Bill settled',
        },
        metadata,
      );
    }

    this.raiseEvent<OrderSettledPayload>(
      'OrderSettled',
      {
        orderId: this.id,
        branchId: this.state.branchId,
        restaurantId: this.state.restaurantId,
        customerId: this.state.customerId,
        paymentMode: params.paymentMode,
        gatewayReference: params.gatewayReference,
        subtotalGbp: this.state.subtotalGbp,
        vatTotalGbp: this.state.vatTotalGbp,
        deliveryFeeGbp: this.state.deliveryFeeGbp,
        tipAmountGbp: formatGbp(cleanTip),
        loyaltyDiscountGbp: this.state.loyaltyDiscountGbp,
        finalTotalGbp: formatGbp(finalTotal),
        allowLoyaltyEarn: this.state.allowLoyaltyEarn,
      },
      metadata,
    );

    return ok(undefined);
  }

  public cancelOrReject(
    terminalStatus: 'CANCELLED' | 'REJECTED',
    reason: string,
    metadata: EventMetadata,
  ): Result<void> {
    const machine = resolveOrderStateMachine(this.state.stateMachineCode);
    const valid = machine.validateTransition(this.state.status, terminalStatus);
    if (!valid.ok) return valid;

    this.raiseEvent<OrderCancelledOrRejectedPayload>(
      'OrderCancelledOrRejected',
      {
        orderId: this.id,
        branchId: this.state.branchId,
        restaurantId: this.state.restaurantId,
        customerId: this.state.customerId,
        terminalStatus,
        reason,
        wasPaid: this.state.isPaid,
        refundAmountGbp: this.state.isPaid ? this.state.totalAmountGbp : '0.00',
      },
      metadata,
    );

    return ok(undefined);
  }

  protected apply(event: DomainEvent<unknown>): void {
    switch (event.eventType) {
      case 'OrderPlaced': {
        const p = event.payload as OrderPlacedPayload;
        this.state.branchId = p.branchId;
        this.state.restaurantId = p.restaurantId;
        this.state.customerId = p.customerId;
        this.state.diningTableId = p.diningTableId;
        this.state.orderSource = p.orderSource;
        this.state.status = p.initialStatus;
        this.state.stateMachineCode = p.stateMachineCode;
        this.state.paymentMode = p.paymentMode;
        this.state.idempotencyKey = p.idempotencyKey;
        this.state.posTerminalId = p.posTerminalId;
        this.state.posReceiptNumber = p.posReceiptNumber;
        this.state.occurredAt = p.occurredAt;
        this.state.syncedAt = p.syncedAt;
        this.state.items = [
          ...p.items,
        ];
        this.state.subtotalGbp = p.subtotalGbp;
        this.state.vatTotalGbp = p.vatTotalGbp;
        this.state.deliveryFeeGbp = p.deliveryFeeGbp;
        this.state.loyaltyPointsHeld = p.loyaltyPointsHeld;
        this.state.loyaltyWalletScope = p.loyaltyWalletScope;
        this.state.loyaltyDiscountGbp = p.loyaltyDiscountGbp;
        this.state.totalAmountGbp = p.totalAmountGbp;
        this.state.allowLoyaltyEarn = p.allowLoyaltyEarn;
        this.state.allowLoyaltyRedeem = p.allowLoyaltyRedeem;
        break;
      }
      case 'OrderTransitioned': {
        const p = event.payload as OrderTransitionedPayload;
        this.state.status = p.toStatus;
        if (p.deliveryProviderCode) this.state.deliveryProviderCode = p.deliveryProviderCode;
        if (p.externalDeliveryId) this.state.externalDeliveryId = p.externalDeliveryId;
        if (p.providerPayloadSnapshot) {
          this.state.providerPayloadSnapshot = p.providerPayloadSnapshot;
        }
        break;
      }
      case 'OrderSettled': {
        const p = event.payload as OrderSettledPayload;
        this.state.paymentMode = p.paymentMode;
        this.state.gatewayReference = p.gatewayReference;
        this.state.tipAmountGbp = p.tipAmountGbp;
        this.state.totalAmountGbp = p.finalTotalGbp;
        this.state.isPaid = true;
        break;
      }
      case 'OrderCancelledOrRejected': {
        const p = event.payload as OrderCancelledOrRejectedPayload;
        this.state.status = p.terminalStatus;
        break;
      }
      case 'KitchenTicketRequested':
        break;
    }
  }

  public get snapshot(): Readonly<OrderAggregateState> {
    return this.state;
  }

  public shouldTakeMemento(): boolean {
    return this._version > 0 && this._version % 5 === 0;
  }

  public accept<TResult>(visitor: OrderVisitor<TResult>): TResult {
    return visitor.visitOrder({
      id: this.id,
      branchId: this.state.branchId,
      diningTableId: this.state.diningTableId,
      items: this.state.items,
      subtotalGbp: this.state.subtotalGbp,
      vatTotalGbp: this.state.vatTotalGbp,
      totalAmountGbp: this.state.totalAmountGbp,
    });
  }
}
