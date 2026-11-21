import {
  OrderLineItemTable,
  OrderLineModifierTable,
  OrderMilestoneLogTable,
  OrderTable,
  type Pool,
  type PoolClient,
  sqlInsert,
  sqlUpdate,
} from '@foodapp/db';
import type { EventBus } from '@/core/application/event-bus';
import type { DomainEvent } from '@/core/domain/domain-event';
import type { PgEventStore } from '@/core/infrastructure/pg-event-store';
import { OrderAggregate, type OrderAggregateState } from '@/ordering/domain/order-aggregate';
import type { PosOrderPlacedPayload, PosOrderSettledPayload } from '@/ordering/domain/order-events';

export class OrderRepository {
  private readonly pool: Pool;
  private readonly eventStore: PgEventStore;
  private readonly eventBus: EventBus;

  constructor(pool: Pool, eventStore: PgEventStore, eventBus: EventBus) {
    this.pool = pool;
    this.eventStore = eventStore;
    this.eventBus = eventBus;
  }

  async findById(orderId: string): Promise<OrderAggregate | null> {
    const { events, memento } = await this.eventStore.loadStream<OrderAggregateState>(orderId);
    if (!memento && events.length === 0) {
      return null;
    }

    const aggregate = OrderAggregate.empty(orderId);
    aggregate.loadFromHistory(events, memento);
    return aggregate;
  }

  private async projectLineModifiers(
    client: PoolClient,
    lineItemId: string,
    modifiers: PosOrderPlacedPayload['items'][number]['modifiers'],
    actorId: string,
  ): Promise<void> {
    for (const mod of modifiers) {
      const insertMod = sqlInsert(OrderLineModifierTable)
        .values({
          orderLineItemId: lineItemId,
          modifierName: mod.name,
          frozenPrice: mod.extraPrice.toFixed(2),
          createdBy: actorId,
          updatedBy: actorId,
        })
        .compile();

      await client.query(insertMod.text, insertMod.params);
    }
  }

  private async projectOrderPlaced(client: PoolClient, event: DomainEvent<unknown>): Promise<void> {
    const actorId = event.metadata.actorId;
    const p = event.payload as unknown as PosOrderPlacedPayload;

    const insertOrder = sqlInsert(OrderTable)
      .values({
        id: event.aggregateId,
        branchId: p.restaurantId,
        customerId: p.customerId ?? null,
        diningTableId: p.diningTableId ?? null,
        orderSource: p.orderSource,
        paymentMethod: 'CARD_TERMINAL',
        subtotal: p.subtotal.toFixed(2),
        vatTotal: p.vatTotal.toFixed(2),
        totalAmount: p.totalAmount.toFixed(2),
        rowVersion: event.version,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .compile();

    await client.query(insertOrder.text, insertOrder.params);

    const liCols = OrderLineItemTable.cols;
    for (const item of p.items) {
      const insertLine = sqlInsert(OrderLineItemTable)
        .values({
          orderId: event.aggregateId,
          itemName: item.itemName,
          frozenPrice: item.unitPrice.toFixed(2),
          quantity: item.quantity,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning([
          liCols.id,
        ])
        .compile();

      const lineRes = await client.query<typeof insertLine._result>(
        insertLine.text,
        insertLine.params,
      );
      const lineItemId = lineRes.rows[0]?.id;

      if (lineItemId && item.modifiers.length > 0) {
        await this.projectLineModifiers(client, lineItemId, item.modifiers, actorId);
      }
    }

    const insertLog = sqlInsert(OrderMilestoneLogTable)
      .values({
        orderId: event.aggregateId,
        milestone: 'PLACED',
        createdBy: actorId,
        updatedBy: actorId,
      })
      .compile();

    await client.query(insertLog.text, insertLog.params);
  }

  private async projectOrderSettled(
    client: PoolClient,
    event: DomainEvent<unknown>,
  ): Promise<void> {
    const actorId = event.metadata.actorId;
    const p = event.payload as unknown as PosOrderSettledPayload;
    const { cols } = OrderTable;

    const updateOrder = sqlUpdate(OrderTable)
      .set({
        paymentMethod: p.paymentMethod,
        tipAmount: p.tipAmount.toFixed(2),
        totalAmount: p.finalTotal.toFixed(2),
        rowVersion: event.version,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .whereEq(cols.id, event.aggregateId)
      .whereNull(cols.deletedAt)
      .compile();

    await client.query(updateOrder.text, updateOrder.params);

    const insertSettledLog = sqlInsert(OrderMilestoneLogTable)
      .values({
        orderId: event.aggregateId,
        milestone: 'SERVED',
        createdBy: actorId,
        updatedBy: actorId,
      })
      .compile();

    await client.query(insertSettledLog.text, insertSettledLog.params);
  }

  async save(aggregate: OrderAggregate): Promise<void> {
    const events = aggregate.pullDomainEvents();
    if (events.length === 0) return;

    const memento = aggregate.shouldTakeMemento() ? aggregate.createMemento() : undefined;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Append immutable Domain Events + optional Memento snapshot
      await this.eventStore.appendEvents(events, memento, client);

      // 2. Project current state into relational Read Models within same transaction
      for (const event of events) {
        if (event.eventType === 'PosOrderPlaced') {
          await this.projectOrderPlaced(client, event);
        }

        if (event.eventType === 'PosOrderSettled') {
          await this.projectOrderSettled(client, event);
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
