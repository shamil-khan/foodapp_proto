import {
  FinancialLedgerTable,
  LoyaltyLedgerTable,
  RestaurantTable,
  sqlInsert,
  sqlSelect,
} from '@foodapp/db';
import type { Pool } from 'pg';
import type { EventBus } from '@/core/application/event-bus';
import type { PgEventStore } from '@/core/infrastructure/pg-event-store';
import {
  FinancialLedgerAggregate,
  type LedgerAggregateState,
} from '@/ledger/domain/ledger-aggregate';

export class LedgerRepository {
  constructor(
    private readonly pool: Pool,
    private readonly eventStore: PgEventStore,
    private readonly eventBus: EventBus,
  ) {}

  async findById(ledgerId: string): Promise<FinancialLedgerAggregate | null> {
    const { events, memento } = await this.eventStore.loadStream<LedgerAggregateState>(ledgerId);
    if (!memento && events.length === 0) return null;

    const aggregate = FinancialLedgerAggregate.empty(ledgerId);
    aggregate.loadFromHistory(events, memento);
    return aggregate;
  }

  async getRestaurantFeeRate(restaurantId: string): Promise<number> {
    const { cols } = RestaurantTable;
    const q = sqlSelect(RestaurantTable)
      .select([
        cols.platformFeeRate,
      ])
      .whereEq(cols.id, restaurantId)
      .activeOnly()
      .compile();

    const { rows } = await this.pool.query<typeof q._result>(q.text, q.params);
    const feeRow = rows[0];
    return feeRow ? Number.parseFloat(feeRow.platformFeeRate) : 15.0;
  }

  async saveSettlement(aggregate: FinancialLedgerAggregate): Promise<void> {
    const events = aggregate.pullDomainEvents();
    if (events.length === 0) return;

    const memento = aggregate.shouldTakeMemento() ? aggregate.createMemento() : undefined;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await this.eventStore.appendEvents(events, memento, client);

      for (const event of events) {
        if (event.eventType === 'SettlementRecorded') {
          const payload = event.payload as unknown as {
            orderId: string;
            entries: {
              entityName: string;
              creditAmount: number;
              debitAmount: number;
              description: string;
            }[];
          };

          for (const entry of payload.entries) {
            const insertCmd = sqlInsert(FinancialLedgerTable)
              .values({
                orderId: payload.orderId,
                entityName: entry.entityName,
                creditAmount: entry.creditAmount.toFixed(2),
                debitAmount: entry.debitAmount.toFixed(2),
                description: entry.description,
                createdBy: event.metadata.actorId,
                updatedBy: event.metadata.actorId,
              })
              .compile();

            await client.query(insertCmd.text, insertCmd.params);
          }
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

  async recordLoyaltyTransaction(params: {
    userId: string;
    restaurantId?: string;
    orderId?: string;
    txType: 'EARNED' | 'REDEEMED';
    pointsDelta: number;
    actorId: string;
  }): Promise<void> {
    const insertCmd = sqlInsert(LoyaltyLedgerTable)
      .values({
        userId: params.userId,
        restaurantId: params.restaurantId ?? null,
        orderId: params.orderId ?? null,
        txType: params.txType,
        pointsDelta: params.pointsDelta,
        createdBy: params.actorId,
        updatedBy: params.actorId,
      })
      .compile();

    await this.pool.query(insertCmd.text, insertCmd.params);
  }
}
