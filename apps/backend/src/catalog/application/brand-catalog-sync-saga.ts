import {
  CatalogBranchProjectionTable,
  type DbExecutor,
  type MenuSelectionMode,
  ProcessedEventTable,
  type redisClient,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
  type UnitOfWork,
} from '@foodapp/db';
import type { CatalogRepository } from '@/catalog/infrastructure/catalog-repository';
import type { EventBus } from '@/core/application/event-bus';
import type { PgSagaRepository } from '@/core/infrastructure/pg-saga-repository';
import { AppLogger } from '@/logger';

type RedisClientType = typeof redisClient;

export class BranchCatalogSyncSaga {
  private static readonly SAGA_TYPE = 'BranchCatalogSnapshotSyncSaga';
  private readonly log = new AppLogger('branch-catalog-sync-saga');
  private readonly uow: UnitOfWork;
  private readonly catalogRepo: CatalogRepository;
  private readonly redis: RedisClientType;
  private readonly sagaRepo: PgSagaRepository;

  constructor(
    uow: UnitOfWork,
    catalogRepo: CatalogRepository,
    redis: RedisClientType,
    sagaRepo: PgSagaRepository,
  ) {
    this.uow = uow;
    this.catalogRepo = catalogRepo;
    this.redis = redis;
    this.sagaRepo = sagaRepo;
  }

  private async claimEventOnce(eventId: string, tx: DbExecutor): Promise<boolean> {
    const pCols = ProcessedEventTable.cols;
    const ins = sqlInsert(ProcessedEventTable)
      .values({
        eventId,
        consumerName: 'BranchCatalogSyncSaga',
      })
      .onConflictDoNothing([
        pCols.eventId,
      ])
      .returning([
        pCols.eventId,
      ])
      .compile();

    const row = await tx.queryOne(ins);
    return Boolean(row);
  }

  private async refreshBranchSnapshot(
    branchId: string,
    actorId: string,
    eventId: string,
    preWrite?: (tx: DbExecutor) => Promise<void>,
  ): Promise<void> {
    const snapshot = await this.uow.transaction(async (tx) => {
      if (!(await this.claimEventOnce(eventId, tx))) return null;

      if (preWrite) {
        await preWrite(tx);
      }

      const saga = await this.sagaRepo.findOrCreate(
        BranchCatalogSyncSaga.SAGA_TYPE,
        eventId,
        'REBUILDING_SNAPSHOT',
        {
          branchId,
        },
        actorId,
        tx,
      );
      if (saga.status === 'COMPLETED') return null;

      const built = await this.catalogRepo.rebuildAndPersistSnapshot(branchId, actorId, tx);

      await this.sagaRepo.advanceStep(
        saga.id,
        saga.rowVersion,
        'COMPLETED',
        'COMPLETED',
        {
          branchId,
        },
        actorId,
        null,
        tx,
      );
      return built;
    });

    if (snapshot) {
      if (!this.redis.isOpen) {
        await this.redis.connect();
      }
      await this.redis.set(`menu:snapshot:${branchId}`, JSON.stringify(snapshot), {
        EX: 3600,
      });
      this.log
        .info`Refreshed Redis & JSONB MenuSnapshot (${snapshot.versionHash}) for branch ${branchId}`;
    }
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('BranchCreated', async (event) => {
      const p = event.payload as {
        readonly restaurantId: string;
        readonly brandName: string;
        readonly branchId: string;
        readonly branchName: string;
        readonly postcodeSector: string;
        readonly menuSelectionMode: MenuSelectionMode;
      };

      await this.refreshBranchSnapshot(
        p.branchId,
        event.metadata.actorId,
        event.eventId,
        async (tx) => {
          const cCols = CatalogBranchProjectionTable.cols;
          const existing = sqlSelect(CatalogBranchProjectionTable)
            .select([
              cCols.id,
            ])
            .whereEq(cCols.branchId, p.branchId)
            .compile();

          if (!(await tx.exists(existing))) {
            const ins = sqlInsert(CatalogBranchProjectionTable)
              .values({
                branchId: p.branchId,
                restaurantId: p.restaurantId,
                brandName: p.brandName,
                branchName: p.branchName,
                postcodeSector: p.postcodeSector,
                menuSelectionMode: p.menuSelectionMode,
                createdBy: event.metadata.actorId,
                updatedBy: event.metadata.actorId,
              })
              .compile();
            await tx.execute(ins);
          }
        },
      );
    });

    eventBus.subscribe('BranchSettingsUpdated', async (event) => {
      const p = event.payload as {
        readonly branchId: string;
        readonly menuSelectionMode?: MenuSelectionMode;
      };
      if (!p.menuSelectionMode) return;
      const nextMode = p.menuSelectionMode;

      await this.refreshBranchSnapshot(
        p.branchId,
        event.metadata.actorId,
        event.eventId,
        async (tx) => {
          const cCols = CatalogBranchProjectionTable.cols;
          const upd = sqlUpdate(CatalogBranchProjectionTable)
            .set({
              menuSelectionMode: nextMode,
            })
            .withAuditBump(event.metadata.actorId)
            .whereEq(cCols.branchId, p.branchId)
            .whereNull(cCols.deletedAt)
            .compile();
          await tx.execute(upd);
        },
      );
    });

    eventBus.subscribe('BranchMenuUpdated', async (event) => {
      await this.refreshBranchSnapshot(event.aggregateId, event.metadata.actorId, event.eventId);
    });
  }
}
