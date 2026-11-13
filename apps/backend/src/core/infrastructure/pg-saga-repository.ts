import { SagaStateTable, sqlInsert, sqlSelect, sqlUpdate } from '@foodapp/db';
import type { Pool } from 'pg';

export type SagaStatus = 'RUNNING' | 'COMPLETED' | 'COMPENSATING' | 'FAILED';

export interface SagaRecord<TState = Record<string, unknown>> {
  id: string;
  sagaType: string;
  correlationId: string;
  currentStep: string;
  status: SagaStatus;
  statePayload: TState;
  lastError: string | null;
  rowVersion: number;
}

export class PgSagaRepository {
  constructor(private readonly pool: Pool) {}

  async findOrCreate<TState extends Record<string, unknown>>(
    sagaType: string,
    correlationId: string,
    initialStep: string,
    initialPayload: TState,
    actorId: string,
  ): Promise<SagaRecord<TState>> {
    const { cols } = SagaStateTable;

    const findQuery = sqlSelect(SagaStateTable)
      .select([
        cols.id,
        cols.sagaType,
        cols.correlationId,
        cols.currentStep,
        cols.status,
        cols.statePayload,
        cols.lastError,
        cols.rowVersion,
      ])
      .whereEq(cols.sagaType, sagaType)
      .whereEq(cols.correlationId, correlationId)
      .compile();

    const existing = await this.pool.query<typeof findQuery._result>(
      findQuery.text,
      findQuery.params,
    );

    const existingRow = existing.rows[0];
    if (existingRow) {
      return existingRow as unknown as SagaRecord<TState>;
    }

    const insertQuery = sqlInsert(SagaStateTable)
      .values({
        sagaType,
        correlationId,
        currentStep: initialStep,
        status: 'RUNNING',
        statePayload: initialPayload,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning([
        cols.id,
        cols.sagaType,
        cols.correlationId,
        cols.currentStep,
        cols.status,
        cols.statePayload,
        cols.lastError,
        cols.rowVersion,
      ])
      .compile();

    const inserted = await this.pool.query<typeof insertQuery._result>(
      insertQuery.text,
      insertQuery.params,
    );

    const createdRow = inserted.rows[0];
    if (!createdRow) {
      throw new Error(`Failed to persist initial saga state for ${sagaType}:${correlationId}`);
    }
    return createdRow as unknown as SagaRecord<TState>;
  }

  async advanceStep<TState extends Record<string, unknown>>(
    sagaId: string,
    expectedRowVersion: number,
    nextStep: string,
    status: SagaStatus,
    statePayload: TState,
    actorId: string,
    lastError: string | null = null,
  ): Promise<boolean> {
    const { cols } = SagaStateTable;

    const updateQuery = sqlUpdate(SagaStateTable)
      .set({
        currentStep: nextStep,
        status,
        statePayload,
        lastError,
      })
      .withAuditBump(actorId)
      .whereEq(cols.id, sagaId)
      .whereEq(cols.rowVersion, expectedRowVersion)
      .compile();

    const res = await this.pool.query(updateQuery.text, updateQuery.params);
    return (res.rowCount ?? 0) === 1;
  }
}
