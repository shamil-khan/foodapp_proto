import type { KdsRoutingTarget } from '@foodapp/db';
import type { OrderLineSnapshot } from '@/ordering/domain/order-events';

export interface OrderVisitor<TResult> {
  visitOrder(order: {
    id: string;
    restaurantId: string;
    diningTableId?: string;
    items: readonly OrderLineSnapshot[];
    subtotal: number;
    vatTotal: number;
    totalAmount: number;
  }): TResult;
}

export interface KdsTicketOutput {
  orderId: string;
  tableId?: string;
  stationSlips: Record<
    KdsRoutingTarget,
    {
      itemName: string;
      qty: number;
      mods: string[];
    }[]
  >;
}

export class KdsTicketVisitor implements OrderVisitor<KdsTicketOutput> {
  visitOrder(order: {
    id: string;
    diningTableId?: string;
    items: readonly OrderLineSnapshot[];
  }): KdsTicketOutput {
    const stationSlips: Record<
      KdsRoutingTarget,
      {
        itemName: string;
        qty: number;
        mods: string[];
      }[]
    > = {
      KITCHEN_SCREEN: [],
      BAR_PRINTER: [],
      PASTRY_STATION: [],
    };

    for (const item of order.items) {
      stationSlips[item.kdsTarget].push({
        itemName: item.itemName,
        qty: item.quantity,
        mods: item.modifiers.map((m) => m.name),
      });
    }

    return {
      orderId: order.id,
      tableId: order.diningTableId,
      stationSlips,
    };
  }
}
