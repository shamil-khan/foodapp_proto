import * as crypto from 'node:crypto';
import {
  CatalogBranchProjectionTable,
  type DbExecutor,
  PricingPolicyTable,
  ProcessedEventTable,
  sqlInsert,
  type UnitOfWork,
} from '@foodapp/db';
import type { EventBus } from '@/core/application/event-bus';
import { AppLogger } from '@/logger';

interface BrandRegisteredCatalogPayload {
  readonly restaurantId: string;
  readonly brandName: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly postcodeSector: string;
  readonly isMultiBranchEnterprise: boolean;
  readonly ownerStaffId: string;
}

interface CompensationCatalogPayload {
  readonly restaurantId: string;
  readonly branchId: string;
}

/**
 * Listens to `BrandRegistered` to initialize the brand's default `PricingPolicy` and
 * `CatalogBranchProjection` inside `catalog`, and hard-deletes them if onboarding compensates.
 */
export class BrandCatalogOnboardingHandler {
  private readonly log = new AppLogger('catalog-brand-onboarding');
  private readonly uow: UnitOfWork;
  private readonly eventBus: EventBus;

  constructor(uow: UnitOfWork, eventBus: EventBus) {
    this.uow = uow;
    this.eventBus = eventBus;
  }

  private async claimEventOnce(eventId: string, tx: DbExecutor): Promise<boolean> {
    const pCols = ProcessedEventTable.cols;
    const ins = sqlInsert(ProcessedEventTable)
      .values({
        eventId,
        consumerName: 'BrandCatalogOnboardingHandler',
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

  private async purgeCatalogRecords(restaurantId: string, branchId: string): Promise<void> {
    await this.uow.transaction(async (tx) => {
      await tx.executeRaw(`DELETE FROM "CatalogBranchProjection" WHERE "branchId" = $1`, [
        branchId,
      ]);
      await tx.executeRaw(`DELETE FROM "PricingPolicy" WHERE "restaurantId" = $1`, [
        restaurantId,
      ]);
    });
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('BrandRegistered', async (event) => {
      const p = event.payload as unknown as BrandRegisteredCatalogPayload;

      let committed = false;
      try {
        committed = await this.uow.transaction(async (tx) => {
          if (!(await this.claimEventOnce(event.eventId, tx))) return false;

          const policyQ = sqlInsert(PricingPolicyTable)
            .values({
              restaurantId: p.restaurantId,
              branchId: null,
              menuPricingMode: p.isMultiBranchEnterprise ? 'THRESHOLD_HYBRID' : 'BRANCH_DIRECT',
              maxDirectPriceDeltaPercent: p.isMultiBranchEnterprise ? '10.00' : '25.00',
              allowBranchLocalItems: true,
              createdBy: event.metadata.actorId,
              updatedBy: event.metadata.actorId,
            })
            .compile();
          await tx.execute(policyQ);

          const projQ = sqlInsert(CatalogBranchProjectionTable)
            .values({
              branchId: p.branchId,
              restaurantId: p.restaurantId,
              brandName: p.brandName,
              branchName: p.branchName,
              postcodeSector: p.postcodeSector,
              menuSelectionMode: 'ALL_BRAND_ITEMS',
              createdBy: event.metadata.actorId,
              updatedBy: event.metadata.actorId,
            })
            .compile();
          await tx.execute(projQ);
          return true;
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Catalog onboarding failed';
        await this.eventBus.publish([
          {
            eventId: crypto.randomUUID(),
            aggregateId: p.restaurantId,
            aggregateType: 'CatalogOnboarding',
            eventType: 'BrandOnboardingStepFailed',
            version: 1,
            occurredAt: new Date(),
            payload: {
              restaurantId: p.restaurantId,
              branchId: p.branchId,
              ownerStaffId: p.ownerStaffId,
              failedStep: 'CATALOG_INITIALIZATION',
              reason,
            },
            metadata: event.metadata,
          },
        ]);
        return;
      }

      if (!committed) return;

      await this.eventBus.publish([
        {
          eventId: crypto.randomUUID(),
          aggregateId: p.restaurantId,
          aggregateType: 'CatalogOnboarding',
          eventType: 'BrandCatalogInitialized',
          version: 1,
          occurredAt: new Date(),
          payload: {
            restaurantId: p.restaurantId,
            branchId: p.branchId,
          },
          metadata: event.metadata,
        },
      ]);
      this.log
        .info`Initialized default PricingPolicy & CatalogBranchProjection for ${p.restaurantId}`;
    });

    eventBus.subscribe('BrandOnboardingCompensationRequested', async (event) => {
      const p = event.payload as unknown as CompensationCatalogPayload;
      await this.purgeCatalogRecords(p.restaurantId, p.branchId);
      this.log.info`Purged uncommitted Catalog records for failed brand ${p.restaurantId}`;
    });
  }
}
