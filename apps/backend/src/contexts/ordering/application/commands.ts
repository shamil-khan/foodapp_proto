import * as crypto from 'node:crypto';
import {
  CategoryTable,
  type InStorePaymentMethod,
  ItemModifierTable,
  type KdsRoutingTarget,
  MenuItemTable,
  type OrderSource,
  sqlSelect,
} from '@foodapp/db';
import type { Pool } from 'pg';
import { OrderAggregate } from '@/contexts/ordering/domain/order-aggregate';
import type { OrderLineSnapshot } from '@/contexts/ordering/domain/order-events';
import { type KdsTicketOutput, KdsTicketVisitor } from '@/contexts/ordering/domain/order-visitor';
import type { OrderRepository } from '@/contexts/ordering/infrastructure/order-repository';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';

export interface PlacePosOrderCommand
  extends Command<
    Result<{
      orderId: string;
      kdsTickets: KdsTicketOutput;
    }>
  > {
  readonly restaurantId: string;
  readonly diningTableId?: string;
  readonly customerId?: string;
  readonly orderSource: OrderSource;
  readonly items: readonly {
    readonly menuItemId: string;
    readonly quantity: number;
    readonly modifierIds?: readonly string[];
  }[];
}

export class PlacePosOrderHandler
  implements
    CommandHandler<
      PlacePosOrderCommand,
      Result<{
        orderId: string;
        kdsTickets: KdsTicketOutput;
      }>
    >
{
  constructor(
    private readonly pool: Pool,
    private readonly orderRepo: OrderRepository,
    private readonly authz: AuthorizationPolicy,
    private readonly request: RequestContext,
  ) {}

  async execute(cmd: PlacePosOrderCommand): Promise<
    Result<{
      orderId: string;
      kdsTickets: KdsTicketOutput;
    }>
  > {
    const access = this.authz.assertRestaurantAccess(cmd.restaurantId, 'orders:place');
    if (!access.ok) {
      return access;
    }

    const lineSnapshots: OrderLineSnapshot[] = [];
    const mCols = MenuItemTable.cols;
    const cCols = CategoryTable.cols;
    const modCols = ItemModifierTable.cols;

    for (const item of cmd.items) {
      const itemQuery = sqlSelect(MenuItemTable)
        .select([
          mCols.categoryId,
          mCols.name,
          mCols.basePrice,
          mCols.vatRate,
          mCols.kdsTarget,
        ])
        .whereEq(mCols.id, item.menuItemId)
        .whereEq(mCols.isActive, true)
        .activeOnly()
        .compile();

      const itemRes = await this.pool.query<typeof itemQuery._result>(
        itemQuery.text,
        itemQuery.params,
      );

      const menuRow = itemRes.rows[0];
      if (!menuRow) {
        return err(
          new DomainError('ITEM_NOT_FOUND', `Menu item ${item.menuItemId} is unavailable.`, 404),
        );
      }

      const catQuery = sqlSelect(CategoryTable)
        .select([
          cCols.restaurantId,
        ])
        .whereEq(cCols.id, menuRow.categoryId)
        .activeOnly()
        .compile();
      const catRes = await this.pool.query<typeof catQuery._result>(catQuery.text, catQuery.params);
      if (catRes.rows[0]?.restaurantId !== cmd.restaurantId) {
        return err(
          new DomainError(
            'TENANT_FORBIDDEN',
            `Menu item ${item.menuItemId} does not belong to target restaurant.`,
            403,
          ),
        );
      }
      const resolvedMods: {
        name: string;
        extraPrice: number;
      }[] = [];
      if (item.modifierIds && item.modifierIds.length > 0) {
        const modQuery = sqlSelect(ItemModifierTable)
          .select([
            modCols.name,
            modCols.extraPrice,
          ])
          .whereIn(modCols.id, item.modifierIds)
          .whereEq(modCols.menuItemId, item.menuItemId)
          .activeOnly()
          .compile();

        const modRes = await this.pool.query<typeof modQuery._result>(
          modQuery.text,
          modQuery.params,
        );

        for (const m of modRes.rows) {
          resolvedMods.push({
            name: m.name,
            extraPrice: Number.parseFloat(m.extraPrice),
          });
        }
      }

      lineSnapshots.push({
        menuItemId: item.menuItemId,
        itemName: menuRow.name,
        quantity: item.quantity,
        unitPrice: Number.parseFloat(menuRow.basePrice),
        vatRate: Number.parseFloat(menuRow.vatRate),
        kdsTarget: menuRow.kdsTarget as KdsRoutingTarget,
        modifiers: resolvedMods,
      });
    }

    const orderId = crypto.randomUUID();
    const orderResult = OrderAggregate.place(
      orderId,
      {
        restaurantId: cmd.restaurantId,
        diningTableId: cmd.diningTableId,
        customerId: cmd.customerId,
        orderSource: cmd.orderSource,
        items: lineSnapshots,
      },
      {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId: cmd.restaurantId,
      },
    );

    if (!orderResult.ok) {
      return orderResult;
    }

    await this.orderRepo.save(orderResult.value);
    const kdsTickets = orderResult.value.accept(new KdsTicketVisitor()) as KdsTicketOutput;

    return ok({
      orderId,
      kdsTickets,
    });
  }
}

export interface SettlePosOrderCommand extends Command<Result<void>> {
  readonly orderId: string;
  readonly paymentMethod: InStorePaymentMethod;
  readonly tipAmount: number;
}

export class SettlePosOrderHandler implements CommandHandler<SettlePosOrderCommand, Result<void>> {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly authz: AuthorizationPolicy,
    private readonly request: RequestContext,
  ) {}

  async execute(cmd: SettlePosOrderCommand): Promise<Result<void>> {
    const order = await this.orderRepo.findById(cmd.orderId);
    if (!order) {
      return err(new DomainError('ORDER_NOT_FOUND', `Order ${cmd.orderId} not found.`, 404));
    }

    const access = this.authz.assertRestaurantAccess(order.snapshot.restaurantId, 'orders:settle');
    if (!access.ok) {
      return access;
    }

    const settleResult = order.settleBill(cmd.paymentMethod, cmd.tipAmount, {
      requestId: this.request.requestId,
      actorId: this.request.actorId,
      restaurantId: order.snapshot.restaurantId,
    });

    if (!settleResult.ok) {
      return settleResult;
    }

    await this.orderRepo.save(order);
    return ok(undefined);
  }
}
