import type { KdsRoutingTarget } from '@foodapp/db';
import type { OrderLineSnapshot } from '@/orders/domain/order-events';

export interface OrderVisitor<TResult> {
  visitOrder(order: {
    readonly id: string;
    readonly branchId: string;
    readonly diningTableId?: string;
    readonly items: readonly OrderLineSnapshot[];
    readonly subtotalGbp: string;
    readonly vatTotalGbp: string;
    readonly totalAmountGbp: string;
  }): TResult;
}

export interface KdsStationLineSlip {
  readonly itemName: string;
  readonly qty: number;
  readonly mods: readonly string[];
  readonly allergens: readonly string[];
}

export interface KdsTicketOutput {
  readonly orderId: string;
  readonly branchId: string;
  readonly tableId?: string;
  readonly stationSlips: Record<KdsRoutingTarget, KdsStationLineSlip[]>;
}

export class KdsTicketVisitor implements OrderVisitor<KdsTicketOutput> {
  visitOrder(order: {
    readonly id: string;
    readonly branchId: string;
    readonly diningTableId?: string;
    readonly items: readonly OrderLineSnapshot[];
  }): KdsTicketOutput {
    const stationSlips: Record<KdsRoutingTarget, KdsStationLineSlip[]> = {
      KITCHEN_SCREEN: [],
      BAR_PRINTER: [],
      PASTRY_STATION: [],
    };

    for (const item of order.items) {
      stationSlips[item.kdsTarget].push({
        itemName: item.itemName,
        qty: item.quantity,
        mods: item.modifiers.map((m) => m.name),
        allergens: [
          ...item.allergenFlags,
        ],
      });
    }

    return {
      orderId: order.id,
      branchId: order.branchId,
      tableId: order.diningTableId,
      stationSlips,
    };
  }
}
