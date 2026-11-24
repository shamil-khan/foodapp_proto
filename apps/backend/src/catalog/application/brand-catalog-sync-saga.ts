// FILE: apps/backend/src/catalog/application/brand-catalog-sync-saga.ts
import {
  CatalogBranchProjectionTable,
  type MenuSelectionMode,
  type Pool,
  ProcessedEventTable,
  type redisClient,
  sqlInsert,
  sqlSelect,
  sqlUpdate,
} from '@foodapp/db';
import type { CatalogRepository } from '@/catalog/infrastructure/catalog-repository';
import type { EventBus } from '@/core/application/event-bus';
import type { PgSagaRepository } from '@/core/infrastructure/pg-saga-repository';
import { AppLogger } from '@/logger';

type RedisClientType = typeof redisClient;

/**
 * Synchronizes `CatalogBranchProjection` and rebuilds PostgreSQL + Redis `MenuSnapshot`
 * projections whenever `BranchCreated`, `BranchSettingsUpdated`, or `BranchMenuUpdated` fires.
 */
export class BranchCatalogSyncSaga {
  private static readonly SAGA_TYPE = 'BranchCatalogSnapshotSyncSaga';
  private readonly log = new AppLogger('branch-catalog-sync-saga');
  private readonly pool: Pool;
  private readonly catalogRepo: CatalogRepository;
  private readonly redis: RedisClientType;
  private readonly sagaRepo: PgSagaRepository;

  constructor(
    pool: Pool,
    catalogRepo: CatalogRepository,
    redis: RedisClientType,
    sagaRepo: PgSagaRepository,
  ) {
    this.pool = pool;
    this.catalogRepo = catalogRepo;
    this.redis = redis;
    this.sagaRepo = sagaRepo;
  }

  private async claimEventOnce(eventId: string): Promise<boolean> {
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

    const res = await this.pool.query<typeof ins._result>(ins.text, ins.params);
    return (res.rowCount ?? 0) === 1;
  }

  private async refreshBranchSnapshot(
    branchId: string,
    actorId: string,
    eventId: string,
  ): Promise<void> {
    const saga = await this.sagaRepo.findOrCreate(
      BranchCatalogSyncSaga.SAGA_TYPE,
      eventId,
      'REBUILDING_SNAPSHOT',
      {
        branchId,
      },
      actorId,
    );
    if (saga.status === 'COMPLETED') return;

    const snapshot = await this.catalogRepo.rebuildAndPersistSnapshot(branchId, actorId);
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

    await this.sagaRepo.advanceStep(
      saga.id,
      saga.rowVersion,
      'COMPLETED',
      'COMPLETED',
      {
        branchId,
      },
      actorId,
    );
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('BranchCreated', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;
      const p = event.payload as {
        readonly restaurantId: string;
        readonly brandName: string;
        readonly branchId: string;
        readonly branchName: string;
        readonly postcodeSector: string;
        readonly menuSelectionMode: MenuSelectionMode;
      };

      const cCols = CatalogBranchProjectionTable.cols;
      const existing = sqlSelect(CatalogBranchProjectionTable)
        .select([
          cCols.id,
        ])
        .whereEq(cCols.branchId, p.branchId)
        .compile();
      const found = (await this.pool.query<typeof existing._result>(existing.text, existing.params))
        .rows[0];

      if (!found) {
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
        await this.pool.query(ins.text, ins.params);
      }

      await this.refreshBranchSnapshot(p.branchId, event.metadata.actorId, event.eventId);
    });

    eventBus.subscribe('BranchSettingsUpdated', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;
      const p = event.payload as {
        readonly branchId: string;
        readonly menuSelectionMode?: MenuSelectionMode;
      };
      if (!p.menuSelectionMode) return;

      const cCols = CatalogBranchProjectionTable.cols;
      const upd = sqlUpdate(CatalogBranchProjectionTable)
        .set({
          menuSelectionMode: p.menuSelectionMode,
        })
        .withAuditBump(event.metadata.actorId)
        .whereEq(cCols.branchId, p.branchId)
        .whereNull(cCols.deletedAt)
        .compile();
      await this.pool.query(upd.text, upd.params);

      await this.refreshBranchSnapshot(p.branchId, event.metadata.actorId, event.eventId);
    });

    eventBus.subscribe('BranchMenuUpdated', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;
      await this.refreshBranchSnapshot(event.aggregateId, event.metadata.actorId, event.eventId);
    });
  }
}
