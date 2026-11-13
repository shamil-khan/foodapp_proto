import { AggregateMementoTable, DomainEventStoreTable, sqlInsert, sqlSelect } from '@foodapp/db';
import type { Pool, PoolClient } from 'pg';
import type { DomainEvent, EventMetadata } from '@/core/domain/domain-event';
import type { Memento } from '@/core/domain/memento';

export class PgEventStore {
  constructor(private readonly pool: Pool) {}

  async appendEvents(
    events: readonly DomainEvent[],
    memento?: Memento<unknown>,
    externalClient?: PoolClient,
  ): Promise<void> {
    if (events.length === 0) return;

    const client = externalClient ?? (await this.pool.connect());
    const manageTx = !externalClient;

    try {
      if (manageTx) await client.query('BEGIN');

      for (const event of events) {
        const insertEvent = sqlInsert(DomainEventStoreTable)
          .values({
            id: event.eventId,
            aggregateId: event.aggregateId,
            aggregateType: event.aggregateType,
            version: event.version,
            eventType: event.eventType,
            payload: event.payload as Record<string, unknown>,
            metadata: event.metadata as unknown as Record<string, unknown>,
            occurredAt: event.occurredAt,
            createdBy: event.metadata.actorId,
          })
          .compile();

        await client.query(insertEvent.text, insertEvent.params);
      }

      if (memento) {
        const actorId = events[0].metadata.actorId;
        const mCols = AggregateMementoTable.cols;

        const insertMemento = sqlInsert(AggregateMementoTable)
          .values({
            aggregateId: memento.aggregateId,
            aggregateType: memento.aggregateType,
            version: memento.version,
            snapshot: memento.state as Record<string, unknown>,
            createdBy: actorId,
          })
          .onConflictDoNothing([
            mCols.aggregateId,
            mCols.version,
          ])
          .compile();

        await client.query(insertMemento.text, insertMemento.params);
      }

      if (manageTx) await client.query('COMMIT');
    } catch (error) {
      if (manageTx) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (manageTx) client.release();
    }
  }

  async loadStream<TState>(aggregateId: string): Promise<{
    events: DomainEvent[];
    memento?: Memento<TState>;
  }> {
    const mCols = AggregateMementoTable.cols;
    const mementoQuery = sqlSelect(AggregateMementoTable)
      .select([
        mCols.aggregateId,
        mCols.aggregateType,
        mCols.version,
        mCols.snapshot,
        mCols.createdAt,
      ])
      .whereEq(mCols.aggregateId, aggregateId)
      .orderBy(mCols.version, 'DESC')
      .take(1)
      .compile();

    const mementoRes = await this.pool.query<typeof mementoQuery._result>(
      mementoQuery.text,
      mementoQuery.params,
    );

    const latestMemento = mementoRes.rows[0];
    const fromVersion = latestMemento ? latestMemento.version : 0;

    const eCols = DomainEventStoreTable.cols;
    const eventsQuery = sqlSelect(DomainEventStoreTable)
      .select([
        eCols.id,
        eCols.aggregateId,
        eCols.aggregateType,
        eCols.version,
        eCols.eventType,
        eCols.payload,
        eCols.metadata,
        eCols.occurredAt,
      ])
      .whereEq(eCols.aggregateId, aggregateId)
      .whereGt(eCols.version, fromVersion)
      .orderBy(eCols.version, 'ASC')
      .compile();

    const eventsRes = await this.pool.query<typeof eventsQuery._result>(
      eventsQuery.text,
      eventsQuery.params,
    );

    return {
      memento: latestMemento
        ? {
            aggregateId: latestMemento.aggregateId,
            aggregateType: latestMemento.aggregateType,
            version: latestMemento.version,
            state: latestMemento.snapshot as TState,
            createdAt: latestMemento.createdAt,
          }
        : undefined,
      events: eventsRes.rows.map((row) => ({
        eventId: row.id,
        aggregateId: row.aggregateId,
        aggregateType: row.aggregateType,
        version: row.version,
        eventType: row.eventType,
        payload: row.payload,
        metadata: row.metadata as unknown as EventMetadata,
        occurredAt: row.occurredAt,
      })),
    };
  }
}
