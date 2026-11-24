import {
  OrderLineItemTable,
  OrderMilestoneLogTable,
  OrderTable,
  type Pool,
  type PoolClient,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
} from '@foodapp/db';
import type { RequestContext } from '@/core/application/authorization';
import type { EventBus } from '@/core/application/event-bus';
import type { DomainEvent } from '@/core/domain/domain-event';
import type { PgEventStore } from '@/core/infrastructure/pg-event-store';
import { ScopedRepository } from '@/core/infrastructure/scoped-repository';
import { OrderAggregate, type OrderAggregateState } from '@/orders/domain/order-aggregate';
import type {
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

function mapStatusToLegacyMilestone(status: OrderStatus): string {
  switch (status) {
    case 'ACCEPTED':
      return 'RESTAURANT_ACCEPTED';
    case 'PREPARING':
    case 'PACKING':
      return 'FOOD_PREPARING';
    case 'READY_FOR_PICKUP':
      return 'READY_FOR_COLLECTION';
    case 'OUT_FOR_DELIVERY':
      return 'EN_ROUTE';
    case 'COMPLETED':
      return 'DELIVERED';
    case 'CANCELLED':
    case 'REJECTED':
      return 'CANCELLED';
    default:
      return 'PLACED';
  }
}

export class OrderRepository extends ScopedRepository {
  private readonly pool: Pool;
  private readonly eventStore: PgEventStore;
  private readonly eventBus: EventBus;

  constructor(pool: Pool, eventStore: PgEventStore, eventBus: EventBus, request: RequestContext) {
    super(request);
    this.pool = pool;
    this.eventStore = eventStore;
    this.eventBus = eventBus;
  }

  async findById(orderId: string): Promise<OrderAggregate | null> {
    const { events, memento } = await this.eventStore.loadStream<OrderAggregateState>(orderId);
    if (memento || events.length > 0) {
      const agg = OrderAggregate.empty(orderId);
      agg.loadFromHistory(events, memento);
      return agg;
    }

    // Fallback reconstruction for legacy seeded orders lacking event streams
    const oCols = OrderTable.cols;
    const oQ = sqlSelect(OrderTable).whereEq(oCols.id, orderId).activeOnly().compile();
    const row = (await this.pool.query<typeof oQ._result>(oQ.text, oQ.params)).rows[0];
    if (!row) return null;

    const liCols = OrderLineItemTable.cols;
    const liQ = sqlSelect(OrderLineItemTable)
      .whereEq(liCols.orderId, orderId)
      .activeOnly()
      .compile();
    const lineRows = (await this.pool.query<typeof liQ._result>(liQ.text, liQ.params)).rows;

    const items: OrderLineSnapshot[] = lineRows.map((l) => ({
      lineId: l.id,
      menuItemId: l.menuItemId ?? l.id,
      itemName: l.itemName,
      quantity: l.quantity,
      unitPriceGbp: l.frozenPrice,
      vatRatePercent: l.vatRateSnapshot,
      vatAmountGbp: l.vatAmountSnapshot,
      allergenFlags: l.allergenFlagsSnapshot ?? [],
      kdsTarget: 'KITCHEN_SCREEN',
      modifiers: Array.isArray(l.modifiersSnapshot)
        ? (l.modifiersSnapshot as unknown as OrderItemModifierSnapshot[])
        : [],
    }));

    return OrderAggregate.fromSnapshot(
      row.id,
      {
        branchId: row.branchId,
        restaurantId: '',
        customerId: row.customerId ?? undefined,
        diningTableId: row.diningTableId ?? undefined,
        orderSource: row.orderSource as OrderChannel,
        status: row.status as OrderStatus,
        stateMachineCode: row.stateMachineCode as OrderStateMachineCode,
        paymentMode: row.paymentMethod as OrderPaymentMode,
        isPaid: row.status === 'COMPLETED',
        idempotencyKey: row.idempotencyKey ?? undefined,
        posTerminalId: row.posTerminalId ?? undefined,
        posReceiptNumber: row.posReceiptNumber ?? undefined,
        occurredAt: new Date(row.occurredAt).toISOString(),
        syncedAt: row.syncedAt ? new Date(row.syncedAt).toISOString() : undefined,
        items,
        subtotalGbp: row.subtotal,
        vatTotalGbp: row.vatTotal,
        deliveryFeeGbp: row.deliveryFee,
        tipAmountGbp: row.tipAmount,
        loyaltyPointsHeld: row.loyaltyPointsHeld,
        loyaltyWalletScope: (row.loyaltyWalletScope as OrderLoyaltyScope | null) ?? undefined,
        loyaltyDiscountGbp: row.loyaltyDiscountGbp,
        totalAmountGbp: row.totalAmount,
        allowLoyaltyEarn: row.allowLoyaltyEarn,
        allowLoyaltyRedeem: row.allowLoyaltyRedeem,
        deliveryProviderCode: row.deliveryProviderCode ?? undefined,
        externalDeliveryId: row.externalDeliveryId ?? undefined,
        providerPayloadSnapshot: row.providerPayloadSnapshot ?? undefined,
      },
      row.rowVersion,
    );
  }

  async findByBranchIdempotencyKey(
    branchId: string,
    idempotencyKey: string,
  ): Promise<string | null> {
    const oCols = OrderTable.cols;
    const q = sqlSelect(OrderTable)
      .select([
        oCols.id,
      ])
      .whereEq(oCols.branchId, branchId)
      .whereEq(oCols.idempotencyKey, idempotencyKey)
      .activeOnly()
      .take(1)
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
    return rows[0]?.id ?? null;
  }

  private async projectOrderPlaced(client: PoolClient, event: DomainEvent<unknown>): Promise<void> {
    const actorId = event.metadata.actorId;
    const p = event.payload as OrderPlacedPayload;

    const insOrder = sqlInsert(OrderTable)
      .values({
        id: p.orderId,
        branchId: p.branchId,
        customerId: p.customerId ?? null,
        diningTableId: p.diningTableId ?? null,
        orderSource: p.orderSource,
        paymentMethod: p.paymentMode,
        status: p.initialStatus,
        stateMachineCode: p.stateMachineCode,
        idempotencyKey: p.idempotencyKey ?? null,
        posTerminalId: p.posTerminalId ?? null,
        posReceiptNumber: p.posReceiptNumber ?? null,
        occurredAt: new Date(p.occurredAt),
        syncedAt: p.syncedAt ? new Date(p.syncedAt) : null,
        subtotal: p.subtotalGbp,
        vatTotal: p.vatTotalGbp,
        deliveryFee: p.deliveryFeeGbp,
        tipAmount: '0.00',
        totalAmount: p.totalAmountGbp,
        loyaltyPointsHeld: p.loyaltyPointsHeld,
        loyaltyWalletScope: p.loyaltyWalletScope ?? null,
        loyaltyDiscountGbp: p.loyaltyDiscountGbp,
        allowLoyaltyEarn: p.allowLoyaltyEarn,
        allowLoyaltyRedeem: p.allowLoyaltyRedeem,
        rowVersion: event.version,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .compile();

    await client.query(insOrder.text, insOrder.params);

    for (const item of p.items) {
      const insLine = sqlInsert(OrderLineItemTable)
        .values({
          orderId: p.orderId,
          menuItemId: item.menuItemId,
          itemName: item.itemName,
          frozenPrice: item.unitPriceGbp,
          quantity: item.quantity,
          vatRateSnapshot: item.vatRatePercent,
          vatAmountSnapshot: item.vatAmountGbp,
          allergenFlagsSnapshot: [
            ...item.allergenFlags,
          ],
          modifiersSnapshot: item.modifiers as unknown as Record<string, unknown>,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .compile();

      await client.query(insLine.text, insLine.params);
    }

    const insLog = sqlInsert(OrderMilestoneLogTable)
      .values({
        orderId: p.orderId,
        milestone: mapStatusToLegacyMilestone(p.initialStatus),
        createdBy: actorId,
        updatedBy: actorId,
      })
      .compile();

    await client.query(insLog.text, insLog.params);
  }

  private async projectOrderTransitioned(
    client: PoolClient,
    event: DomainEvent<unknown>,
  ): Promise<void> {
    const actorId = event.metadata.actorId;
    const p = event.payload as OrderTransitionedPayload;
    const oCols = OrderTable.cols;

    const upd = sqlUpdate(OrderTable)
      .set({
        status: p.toStatus,
        deliveryProviderCode: p.deliveryProviderCode,
        externalDeliveryId: p.externalDeliveryId,
        providerPayloadSnapshot: p.providerPayloadSnapshot,
        rowVersion: event.version,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .whereEq(oCols.id, p.orderId)
      .whereNull(oCols.deletedAt)
      .compile();

    await client.query(upd.text, upd.params);

    const logIns = sqlInsert(OrderMilestoneLogTable)
      .values({
        orderId: p.orderId,
        milestone: mapStatusToLegacyMilestone(p.toStatus),
        createdBy: actorId,
        updatedBy: actorId,
      })
      .compile();

    await client.query(logIns.text, logIns.params);
  }

  private async projectOrderSettled(
    client: PoolClient,
    event: DomainEvent<unknown>,
  ): Promise<void> {
    const actorId = event.metadata.actorId;
    const p = event.payload as OrderSettledPayload;
    const oCols = OrderTable.cols;

    const upd = sqlUpdate(OrderTable)
      .set({
        paymentMethod: p.paymentMode,
        tipAmount: p.tipAmountGbp,
        totalAmount: p.finalTotalGbp,
        rowVersion: event.version,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .whereEq(oCols.id, p.orderId)
      .whereNull(oCols.deletedAt)
      .compile();

    await client.query(upd.text, upd.params);
  }

  private async projectOrderCancelled(
    client: PoolClient,
    event: DomainEvent<unknown>,
  ): Promise<void> {
    const actorId = event.metadata.actorId;
    const p = event.payload as OrderCancelledOrRejectedPayload;
    const oCols = OrderTable.cols;

    const upd = sqlUpdate(OrderTable)
      .set({
        status: p.terminalStatus,
        rowVersion: event.version,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .whereEq(oCols.id, p.orderId)
      .whereNull(oCols.deletedAt)
      .compile();

    await client.query(upd.text, upd.params);

    const logIns = sqlInsert(OrderMilestoneLogTable)
      .values({
        orderId: p.orderId,
        milestone: 'CANCELLED',
        createdBy: actorId,
        updatedBy: actorId,
      })
      .compile();

    await client.query(logIns.text, logIns.params);
  }

  async save(aggregate: OrderAggregate): Promise<void> {
    const events = aggregate.pullDomainEvents();
    if (events.length === 0) return;

    const memento = aggregate.shouldTakeMemento() ? aggregate.createMemento() : undefined;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await this.eventStore.appendEvents(events, memento, client);

      for (const event of events) {
        if (event.eventType === 'OrderPlaced') {
          await this.projectOrderPlaced(client, event);
        } else if (event.eventType === 'OrderTransitioned') {
          await this.projectOrderTransitioned(client, event);
        } else if (event.eventType === 'OrderSettled') {
          await this.projectOrderSettled(client, event);
        } else if (event.eventType === 'OrderCancelledOrRejected') {
          await this.projectOrderCancelled(client, event);
        }
      }

      await client.query('COMMIT');
      await this.eventBus.publish(events);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
