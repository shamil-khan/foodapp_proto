import {
  AggregateMementoTable,
  type DbExecutor,
  DomainEventStoreTable,
  sqlInsert,
  sqlSelect,
  type UnitOfWork,
} from '@foodapp/db';
import type { DomainEvent, EventMetadata } from '@/core/domain/domain-event';
import type { Memento } from '@/core/domain/memento';

export class PgEventStore {
  private readonly uow: UnitOfWork;

  constructor(uow: UnitOfWork) {
    this.uow = uow;
  }

  async appendEvents(
    events: readonly DomainEvent<unknown>[],
    memento?: Memento<unknown>,
    externalTx?: DbExecutor,
  ): Promise<void> {
    if (events.length === 0) return;

    const writeWith = async (tx: DbExecutor): Promise<void> => {
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

        await tx.execute(insertEvent);
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

        await tx.execute(insertMemento);
      }
    };

    if (externalTx) {
      await writeWith(externalTx);
      return;
    }

    await this.uow.transaction(writeWith);
  }

  async loadStream<TState>(aggregateId: string): Promise<{
    events: DomainEvent<unknown>[];
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

    const latestMemento = await this.uow.queryOne(mementoQuery);
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

    const eventRows = await this.uow.queryMany(eventsQuery);

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
      events: eventRows.map((row) => ({
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
