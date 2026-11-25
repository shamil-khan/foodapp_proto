import {
  type DbExecutor,
  SagaStateTable,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
  type UnitOfWork,
} from '@foodapp/db';

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
  private readonly uow: UnitOfWork;

  constructor(uow: UnitOfWork) {
    this.uow = uow;
  }

  async findOrCreate<TState extends Record<string, unknown>>(
    sagaType: string,
    correlationId: string,
    initialStep: string,
    initialPayload: TState,
    actorId: string,
    tx: DbExecutor = this.uow,
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

    const existingRow = await tx.queryOne(findQuery);
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

    const createdRow = await tx.queryOne(insertQuery);
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
    tx: DbExecutor = this.uow,
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

    const rowCount = await tx.execute(updateQuery);
    return rowCount === 1;
  }
}
