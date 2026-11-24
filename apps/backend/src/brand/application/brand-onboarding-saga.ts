// FILE: apps/backend/src/brand/application/brand-onboarding-saga.ts (Part 1 of 2)
import * as crypto from 'node:crypto';
import type { Pool } from '@foodapp/db';
import type {
  BrandCatalogInitializedPayload,
  BrandOnboardingCompensationPayload,
  BrandOnboardingStepFailedPayload,
  BrandOwnerBootstrappedPayload,
  BrandRegisteredPayload,
} from '@/brand/domain/brand-events';
import type { EventBus } from '@/core/application/event-bus';
import type { PgSagaRepository } from '@/core/infrastructure/pg-saga-repository';
import { AppLogger } from '@/logger';

interface BrandOnboardingSagaState extends Record<string, unknown> {
  restaurantId: string;
  branchId: string;
  ownerStaffId: string;
  iamBootstrapped: boolean;
  catalogInitialized: boolean;
}

/**
 * Coordinates cross-context brand onboarding across `brand`, `iam`, and `catalog`.
 * Guarantees all-or-nothing atomicity: any downstream step failure triggers reverse-order
 * hard-delete compensation so uncommitted tenant rows and UNIQUE handles/emails are purged.
 */
export class BrandOnboardingSaga {
  private static readonly SAGA_TYPE = 'BrandOnboardingCoordinationSaga';
  private readonly log = new AppLogger('brand-onboarding-saga');
  private readonly pool: Pool;
  private readonly eventBus: EventBus;
  private readonly sagaRepo: PgSagaRepository;

  constructor(pool: Pool, eventBus: EventBus, sagaRepo: PgSagaRepository) {
    this.pool = pool;
    this.eventBus = eventBus;
    this.sagaRepo = sagaRepo;
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('BrandRegistered', async (event) => {
      const p = event.payload as unknown as BrandRegisteredPayload;
      await this.sagaRepo.findOrCreate<BrandOnboardingSagaState>(
        BrandOnboardingSaga.SAGA_TYPE,
        p.restaurantId,
        'AWAITING_IAM_AND_CATALOG_BOOTSTRAP',
        {
          restaurantId: p.restaurantId,
          branchId: p.branchId,
          ownerStaffId: p.ownerStaffId,
          iamBootstrapped: false,
          catalogInitialized: false,
        },
        event.metadata.actorId,
      );
    });

    eventBus.subscribe('BrandOwnerBootstrapped', async (event) => {
      const p = event.payload as unknown as BrandOwnerBootstrappedPayload;
      await this.markStepDone(p.restaurantId, 'iamBootstrapped', event.metadata.actorId);
    });

    eventBus.subscribe('BrandCatalogInitialized', async (event) => {
      const p = event.payload as unknown as BrandCatalogInitializedPayload;
      await this.markStepDone(p.restaurantId, 'catalogInitialized', event.metadata.actorId);
    });

    eventBus.subscribe('BrandOnboardingStepFailed', async (event) => {
      const p = event.payload as unknown as BrandOnboardingStepFailedPayload;
      await this.compensateFailure(p, event.metadata.actorId, event.metadata.requestId);
    });
  }
  // FILE: apps/backend/src/brand/application/brand-onboarding-saga.ts (Part 2 of 2)
  private async markStepDone(
    restaurantId: string,
    field: 'iamBootstrapped' | 'catalogInitialized',
    actorId: string,
  ): Promise<void> {
    const saga = await this.sagaRepo.findOrCreate<BrandOnboardingSagaState>(
      BrandOnboardingSaga.SAGA_TYPE,
      restaurantId,
      'AWAITING_IAM_AND_CATALOG_BOOTSTRAP',
      {
        restaurantId,
        branchId: '',
        ownerStaffId: '',
        iamBootstrapped: false,
        catalogInitialized: false,
      },
      actorId,
    );
    if (saga.status === 'COMPLETED' || saga.status === 'FAILED') return;

    const nextState: BrandOnboardingSagaState = {
      ...saga.statePayload,
      [field]: true,
    };
    const isComplete = nextState.iamBootstrapped && nextState.catalogInitialized;
    await this.sagaRepo.advanceStep(
      saga.id,
      saga.rowVersion,
      isComplete ? 'COMPLETED' : 'PARTIAL_BOOTSTRAP_DONE',
      isComplete ? 'COMPLETED' : 'RUNNING',
      nextState,
      actorId,
    );
  }

  private async purgeBrandTables(restaurantId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM "PaymentConfig" WHERE "restaurantId" = $1`, [
        restaurantId,
      ]);
      await client.query(`DELETE FROM "RestaurantLayout" WHERE "restaurantId" = $1`, [
        restaurantId,
      ]);
      await client.query(`DELETE FROM "RestaurantBranch" WHERE "restaurantId" = $1`, [
        restaurantId,
      ]);
      await client.query(`DELETE FROM "Restaurant" WHERE "id" = $1`, [
        restaurantId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async compensateFailure(
    failed: BrandOnboardingStepFailedPayload,
    actorId: string,
    requestId?: string,
  ): Promise<void> {
    const saga = await this.sagaRepo.findOrCreate<BrandOnboardingSagaState>(
      BrandOnboardingSaga.SAGA_TYPE,
      failed.restaurantId,
      'COMPENSATING',
      {
        restaurantId: failed.restaurantId,
        branchId: failed.branchId,
        ownerStaffId: failed.ownerStaffId,
        iamBootstrapped: false,
        catalogInitialized: false,
      },
      actorId,
    );

    await this.eventBus.publish([
      {
        eventId: crypto.randomUUID(),
        aggregateId: failed.restaurantId,
        aggregateType: 'BrandOnboardingSaga',
        eventType: 'BrandOnboardingCompensationRequested',
        version: 1,
        occurredAt: new Date(),
        payload: {
          restaurantId: failed.restaurantId,
          branchId: failed.branchId,
          ownerStaffId: failed.ownerStaffId,
          reason: failed.reason,
        } satisfies BrandOnboardingCompensationPayload,
        metadata: {
          requestId,
          actorId,
          restaurantId: failed.restaurantId,
        },
      },
    ]);

    // FILE: apps/backend/src/brand/application/brand-onboarding-saga.ts (End of compensateFailure)
    await this.purgeBrandTables(failed.restaurantId);
    await this.sagaRepo.advanceStep(
      saga.id,
      saga.rowVersion,
      'COMPENSATED',
      'FAILED',
      saga.statePayload,
      actorId,
      `${failed.failedStep}: ${failed.reason}`,
    );
    this.log.error`Rolled back brand onboarding for ${failed.restaurantId}: ${failed.reason}`;
  }
}
