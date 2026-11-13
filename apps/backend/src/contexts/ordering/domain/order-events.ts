import type { InStorePaymentMethod, KdsRoutingTarget, OrderSource } from '@foodapp/db';
import type { DomainEvent } from '@/core/domain/domain-event';

export interface OrderLineSnapshot {
  readonly menuItemId: string;
  readonly itemName: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly vatRate: number;
  readonly kdsTarget: KdsRoutingTarget;
  readonly modifiers: readonly {
    readonly name: string;
    readonly extraPrice: number;
  }[];
}

export interface PosOrderPlacedPayload {
  readonly restaurantId: string;
  readonly diningTableId?: string;
  readonly customerId?: string;
  readonly orderSource: OrderSource;
  readonly items: readonly OrderLineSnapshot[];
  readonly subtotal: number;
  readonly vatTotal: number;
  readonly totalAmount: number;
}

export interface PosOrderSettledPayload {
  readonly restaurantId: string;
  readonly paymentMethod: InStorePaymentMethod;
  readonly subtotal: number;
  readonly vatTotal: number;
  readonly tipAmount: number;
  readonly finalTotal: number;
}

export interface KitchenTicketRequestedPayload {
  readonly restaurantId: string;
  readonly diningTableId?: string;
  readonly ticketsByStation: Record<KdsRoutingTarget, readonly OrderLineSnapshot[]>;
}

export interface LoyaltyPointsEligiblePayload {
  readonly customerId: string;
  readonly restaurantId: string;
  readonly pointsEarned: number;
}

export type PosOrderPlacedEvent = DomainEvent<PosOrderPlacedPayload>;
export type PosOrderSettledEvent = DomainEvent<PosOrderSettledPayload>;
export type KitchenTicketRequestedEvent = DomainEvent<KitchenTicketRequestedPayload>;
export type LoyaltyPointsEligibleEvent = DomainEvent<LoyaltyPointsEligiblePayload>;
