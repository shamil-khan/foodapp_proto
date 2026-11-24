import type { KdsRoutingTarget } from '@foodapp/db';
import type { DomainEvent } from '@/core/domain/domain-event';

export type OrderPaymentMode =
  | 'CASH'
  | 'COD'
  | 'CARD_TERMINAL'
  | 'ONLINE_GATEWAY'
  | 'LOYALTY_POINTS';

export type OrderLoyaltyScope = 'PLATFORM' | 'MERCHANT';

export type OrderChannel = 'DINE_IN' | 'TAKEAWAY' | 'ONLINE_DELIVERY' | 'POS';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'PACKING'
  | 'READY_FOR_PICKUP'
  | 'OUT_FOR_DELIVERY'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED';

export type OrderStateMachineCode =
  | 'HOME_KITCHEN_SIMPLE'
  | 'STANDARD_RESTAURANT'
  | 'FULL_KDS_DELIVERY';

export interface OrderItemModifierSnapshot {
  readonly modifierId: string;
  readonly name: string;
  readonly extraPriceGbp: string;
}

export interface OrderLineSnapshot {
  readonly lineId: string;
  readonly menuItemId: string;
  readonly itemName: string;
  readonly quantity: number;
  readonly unitPriceGbp: string;
  readonly vatRatePercent: string;
  readonly vatAmountGbp: string;
  readonly allergenFlags: readonly string[];
  readonly kdsTarget: KdsRoutingTarget;
  readonly modifiers: readonly OrderItemModifierSnapshot[];
}

export interface OrderPlacedPayload {
  readonly orderId: string;
  readonly branchId: string;
  readonly restaurantId: string;
  readonly customerId?: string;
  readonly diningTableId?: string;
  readonly orderSource: OrderChannel;
  readonly initialStatus: OrderStatus;
  readonly stateMachineCode: OrderStateMachineCode;
  readonly paymentMode: OrderPaymentMode;
  readonly paymentToken?: string;
  readonly idempotencyKey?: string;
  readonly posTerminalId?: string;
  readonly posReceiptNumber?: string;
  readonly occurredAt: string;
  readonly syncedAt?: string;
  readonly items: readonly OrderLineSnapshot[];
  readonly subtotalGbp: string;
  readonly vatTotalGbp: string;
  readonly deliveryFeeGbp: string;
  readonly loyaltyPointsHeld: number;
  readonly loyaltyWalletScope?: OrderLoyaltyScope;
  readonly loyaltyDiscountGbp: string;
  readonly totalAmountGbp: string;
  readonly allowLoyaltyEarn: boolean;
  readonly allowLoyaltyRedeem: boolean;
}

export interface OrderTransitionedPayload {
  readonly orderId: string;
  readonly branchId: string;
  readonly restaurantId: string;
  readonly customerId?: string;
  readonly fromStatus: OrderStatus;
  readonly toStatus: OrderStatus;
  readonly reason?: string;
  readonly deliveryProviderCode?: string;
  readonly externalDeliveryId?: string;
  readonly providerPayloadSnapshot?: Record<string, unknown>;
}

export interface OrderSettledPayload {
  readonly orderId: string;
  readonly branchId: string;
  readonly restaurantId: string;
  readonly customerId?: string;
  readonly paymentMode: OrderPaymentMode;
  readonly gatewayReference?: string;
  readonly subtotalGbp: string;
  readonly vatTotalGbp: string;
  readonly deliveryFeeGbp: string;
  readonly tipAmountGbp: string;
  readonly loyaltyDiscountGbp: string;
  readonly finalTotalGbp: string;
  readonly allowLoyaltyEarn: boolean;
}

export interface OrderCancelledOrRejectedPayload {
  readonly orderId: string;
  readonly branchId: string;
  readonly restaurantId: string;
  readonly customerId?: string;
  readonly terminalStatus: 'CANCELLED' | 'REJECTED';
  readonly reason: string;
  readonly wasPaid: boolean;
  readonly refundAmountGbp: string;
}

export interface KitchenTicketRequestedPayload {
  readonly orderId: string;
  readonly branchId: string;
  readonly diningTableId?: string;
  readonly ticketsByStation: Record<KdsRoutingTarget, readonly OrderLineSnapshot[]>;
}

export interface LoyaltyHoldRequestedPayload {
  readonly orderId: string;
  readonly userId: string;
  readonly restaurantId: string;
  readonly issuerScope: OrderLoyaltyScope;
  readonly pointsToHold: number;
  readonly allowLoyaltyRedeem: boolean;
}

export interface OrderSettlementFinancialsRequestedPayload {
  readonly orderId: string;
  readonly branchId: string;
  readonly restaurantId: string;
  readonly customerId?: string;
  readonly paymentMode: OrderPaymentMode;
  readonly gatewayReference?: string;
  readonly subtotalGbp: string;
  readonly vatGbp: string;
  readonly deliveryFeeGbp: string;
  readonly loyaltyDiscountGbp: string;
  readonly allowLoyaltyEarn: boolean;
}

export type OrderPlacedEvent = DomainEvent<OrderPlacedPayload>;
export type OrderTransitionedEvent = DomainEvent<OrderTransitionedPayload>;
export type OrderSettledEvent = DomainEvent<OrderSettledPayload>;
export type OrderCancelledOrRejectedEvent = DomainEvent<OrderCancelledOrRejectedPayload>;
export type KitchenTicketRequestedEvent = DomainEvent<KitchenTicketRequestedPayload>;
