import * as crypto from 'node:crypto';
import { type DbExecutor, type UnitOfWork } from '@foodapp/db';
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

export class BrandOnboardingSaga {
  private static readonly SAGA_TYPE = 'BrandOnboardingCoordinationSaga';
  private readonly log = new AppLogger('brand-onboarding-saga');
  private readonly uow: UnitOfWork;
  private readonly eventBus: EventBus;
  private readonly sagaRepo: PgSagaRepository;

  constructor(uow: UnitOfWork, eventBus: EventBus, sagaRepo: PgSagaRepository) {
    this.uow = uow;
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

  private async markStepDone(
    restaurantId: string,
    field: 'iamBootstrapped' | 'catalogInitialized',
    actorId: string,
  ): Promise<void> {
    // Wrap Saga read + optimistic-lock step advancement inside a single atomic local UnitOfWork
    await this.uow.transaction(async (tx) => {
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
        tx,
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
        null,
        tx,
      );
    });
  }

  private async purgeBrandTables(tx: DbExecutor, restaurantId: string): Promise<void> {
    await tx.executeRaw(`DELETE FROM "PaymentConfig" WHERE "restaurantId" = $1`, [
      restaurantId,
    ]);
    await tx.executeRaw(`DELETE FROM "RestaurantLayout" WHERE "restaurantId" = $1`, [
      restaurantId,
    ]);
    await tx.executeRaw(`DELETE FROM "RestaurantBranch" WHERE "restaurantId" = $1`, [
      restaurantId,
    ]);
    await tx.executeRaw(`DELETE FROM "Restaurant" WHERE "id" = $1`, [
      restaurantId,
    ]);
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

    // Notify IAM & Catalog contexts to purge their child records before deleting parent Restaurant rows
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

    await this.uow.transaction(async (tx) => {
      await this.purgeBrandTables(tx, failed.restaurantId);
      await this.sagaRepo.advanceStep(
        saga.id,
        saga.rowVersion,
        'COMPENSATED',
        'FAILED',
        saga.statePayload,
        actorId,
        `${failed.failedStep}: ${failed.reason}`,
        tx,
      );
    });

    this.log.error`Rolled back brand onboarding for ${failed.restaurantId}: ${failed.reason}`;
  }
}
