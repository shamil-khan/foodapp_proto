import * as crypto from 'node:crypto';
import {
  CategoryTable,
  ItemModifierTable,
  type KdsRoutingTarget,
  MenuItemTable,
  type Pool,
  RestaurantBranchTable,
  sqlSelect,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import type { AuthorizationPolicy, RequestContext } from '@/core/application/authorization';
import type { Command, CommandHandler } from '@/core/application/cqrs';
import { DomainError, err, ok, type Result } from '@/core/domain/result';
import type { CartLineInput } from '@/orders/application/cart-service';
import { type HydratedCartLineInput, OrderAggregate } from '@/orders/domain/order-aggregate';
import type {
  OrderChannel,
  OrderPaymentMode,
  OrderStateMachineCode,
} from '@/orders/domain/order-events';
import type { OrderRepository } from '@/orders/infrastructure/order-repository';

export interface OfflinePosOrderBatchItem {
  readonly clientOrderId: string;
  readonly posTerminalId: string;
  readonly posReceiptNumber: string;
  readonly occurredAt: string;
  readonly orderSource: OrderChannel;
  readonly paymentMethod: OrderPaymentMode;
  readonly diningTableId?: string;
  readonly customerId?: string;
  readonly tipAmountGbp?: number;
  readonly items: readonly CartLineInput[];
}

export interface SyncPosOrdersCommand
  extends Command<
    Result<{
      readonly syncedCount: number;
      readonly results: readonly {
        readonly clientOrderId: string;
        readonly orderId: string;
        readonly status: 'SYNCED' | 'DUPLICATE_SKIPPED';
      }[];
    }>
  > {
  readonly orders: readonly OfflinePosOrderBatchItem[];
}

export class SyncPosOrdersHandler
  implements
    CommandHandler<
      SyncPosOrdersCommand,
      Result<{
        readonly syncedCount: number;
        readonly results: readonly {
          readonly clientOrderId: string;
          readonly orderId: string;
          readonly status: 'SYNCED' | 'DUPLICATE_SKIPPED';
        }[];
      }>
    >
{
  private readonly pool: Pool;
  private readonly orderRepo: OrderRepository;
  private readonly authz: AuthorizationPolicy;
  private readonly request: RequestContext;

  constructor(
    pool: Pool,
    orderRepo: OrderRepository,
    authz: AuthorizationPolicy,
    request: RequestContext,
  ) {
    this.pool = pool;
    this.orderRepo = orderRepo;
    this.authz = authz;
    this.request = request;
  }

  private async hydratePosLines(
    restaurantId: string,
    items: readonly CartLineInput[],
  ): Promise<Result<HydratedCartLineInput[]>> {
    const mCols = MenuItemTable.cols;
    const cCols = CategoryTable.cols;
    const modCols = ItemModifierTable.cols;
    const out: HydratedCartLineInput[] = [];

    for (const item of items) {
      const mQ = sqlSelect(MenuItemTable).whereEq(mCols.id, item.menuItemId).activeOnly().compile();
      const mRow = (await this.pool.query<typeof mQ._result>(mQ.text, mQ.params)).rows[0];
      if (!mRow) {
        return err(
          new DomainError('ITEM_NOT_FOUND', `Menu item ${item.menuItemId} not found.`, 404),
        );
      }

      const cQ = sqlSelect(CategoryTable)
        .select([
          cCols.restaurantId,
        ])
        .whereEq(cCols.id, mRow.categoryId)
        .activeOnly()
        .compile();
      const cRow = (await this.pool.query<typeof cQ._result>(cQ.text, cQ.params)).rows[0];
      if (cRow?.restaurantId !== restaurantId) {
        return err(
          new DomainError('TENANT_FORBIDDEN', 'Offline POS item belongs to another brand.', 403),
        );
      }

      const mods: {
        modifierId: string;
        name: string;
        extraPriceGbp: Decimal;
      }[] = [];
      if (item.modifierIds && item.modifierIds.length > 0) {
        const modQ = sqlSelect(ItemModifierTable)
          .select([
            modCols.id,
            modCols.name,
            modCols.extraPrice,
          ])
          .whereIn(modCols.id, item.modifierIds)
          .activeOnly()
          .compile();
        const modRows = (await this.pool.query<typeof modQ._result>(modQ.text, modQ.params)).rows;
        for (const m of modRows) {
          mods.push({
            modifierId: m.id,
            name: m.name,
            extraPriceGbp: new Decimal(m.extraPrice),
          });
        }
      }

      out.push({
        lineId: crypto.randomUUID(),
        menuItemId: mRow.id,
        itemName: mRow.name,
        quantity: item.quantity,
        unitPriceGbp: new Decimal(mRow.basePrice),
        vatRatePercent: new Decimal(mRow.vatRate),
        allergenFlags: mRow.allergenFlags ?? [],
        kdsTarget: mRow.kdsTarget as KdsRoutingTarget,
        modifiers: mods,
      });
    }

    return ok(out);
  }

  async execute(cmd: SyncPosOrdersCommand): Promise<
    Result<{
      readonly syncedCount: number;
      readonly results: readonly {
        readonly clientOrderId: string;
        readonly orderId: string;
        readonly status: 'SYNCED' | 'DUPLICATE_SKIPPED';
      }[];
    }>
  > {
    const branchId = this.request.branchId;
    if (!branchId) {
      return err(new DomainError('MISSING_BRANCH', 'Active branch session required.', 403));
    }
    const access = this.authz.assertBranchAccess(branchId, 'orders:place');
    if (!access.ok) return access;

    if (cmd.orders.length === 0 || cmd.orders.length > 50) {
      return err(
        new DomainError('INVALID_BATCH_SIZE', 'POS sync batch must contain 1 to 50 orders.', 400),
      );
    }

    const bCols = RestaurantBranchTable.cols;
    const bQ = sqlSelect(RestaurantBranchTable)
      .select([
        bCols.restaurantId,
        bCols.stateMachineCode,
      ])
      .whereEq(bCols.id, branchId)
      .activeOnly()
      .compile();
    const branch = (await this.pool.query<typeof bQ._result>(bQ.text, bQ.params)).rows[0];
    if (!branch) return err(new DomainError('BRANCH_NOT_FOUND', 'Branch not found.', 404));

    const syncedAt = new Date();
    const results: {
      clientOrderId: string;
      orderId: string;
      status: 'SYNCED' | 'DUPLICATE_SKIPPED';
    }[] = [];

    for (const item of cmd.orders) {
      const existingOrderId = await this.orderRepo.findByBranchIdempotencyKey(
        branchId,
        item.clientOrderId,
      );
      if (existingOrderId) {
        results.push({
          clientOrderId: item.clientOrderId,
          orderId: existingOrderId,
          status: 'DUPLICATE_SKIPPED',
        });
        continue;
      }

      const hydrated = await this.hydratePosLines(branch.restaurantId, item.items);
      if (!hydrated.ok) return hydrated;

      const orderId = crypto.randomUUID();
      const meta = {
        requestId: this.request.requestId,
        actorId: this.request.actorId,
        restaurantId: branch.restaurantId,
      };

      const aggRes = OrderAggregate.createOrder(
        orderId,
        {
          branchId,
          restaurantId: branch.restaurantId,
          customerId: item.customerId,
          diningTableId: item.diningTableId,
          orderSource: item.orderSource,
          stateMachineCode: branch.stateMachineCode as OrderStateMachineCode,
          paymentMode: item.paymentMethod,
          requiresOnlineCapture: false,
          idempotencyKey: item.clientOrderId,
          posTerminalId: item.posTerminalId,
          posReceiptNumber: item.posReceiptNumber,
          occurredAt: new Date(item.occurredAt),
          syncedAt,
          lines: hydrated.value,
        },
        meta,
      );
      if (!aggRes.ok) return aggRes;

      const settleRes = aggRes.value.settleBill(
        {
          paymentMode: item.paymentMethod,
          tipAmountGbp: new Decimal(item.tipAmountGbp ?? 0),
        },
        meta,
      );
      if (!settleRes.ok) return settleRes;

      await this.orderRepo.save(aggRes.value);
      results.push({
        clientOrderId: item.clientOrderId,
        orderId,
        status: 'SYNCED',
      });
    }

    return ok({
      syncedCount: results.filter((r) => r.status === 'SYNCED').length,
      results,
    });
  }
}
