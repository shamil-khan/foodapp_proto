// FILE: apps/backend/src/catalog/application/brand-catalog-onboarding-handlers.ts (Part 1 of 2)
import * as crypto from 'node:crypto';
import {
  CatalogBranchProjectionTable,
  type Pool,
  PricingPolicyTable,
  ProcessedEventTable,
  sqlInsert,
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
  private readonly pool: Pool;
  private readonly eventBus: EventBus;

  constructor(pool: Pool, eventBus: EventBus) {
    this.pool = pool;
    this.eventBus = eventBus;
  }

  private async claimEventOnce(eventId: string): Promise<boolean> {
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

    const res = await this.pool.query<typeof ins._result>(ins.text, ins.params);
    return (res.rowCount ?? 0) === 1;
  }
  // FILE: apps/backend/src/catalog/application/brand-catalog-onboarding-handlers.ts (Part 2 of 2)
  private async purgeCatalogRecords(restaurantId: string, branchId: string): Promise<void> {
    await this.pool.query(`DELETE FROM "CatalogBranchProjection" WHERE "branchId" = $1`, [
      branchId,
    ]);
    await this.pool.query(`DELETE FROM "PricingPolicy" WHERE "restaurantId" = $1`, [
      restaurantId,
    ]);
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('BrandRegistered', async (event) => {
      if (!(await this.claimEventOnce(event.eventId))) return;
      const p = event.payload as unknown as BrandRegisteredCatalogPayload;

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

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
        await client.query(policyQ.text, policyQ.params);

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
        await client.query(projQ.text, projQ.params);

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
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
      } finally {
        client.release();
      }

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
