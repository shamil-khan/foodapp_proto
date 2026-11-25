import * as crypto from 'node:crypto';
import type { UnitOfWork } from '@foodapp/db';
import type { EventBus } from '@/core/application/event-bus';
import type { PgSagaRepository } from '@/core/infrastructure/pg-saga-repository';
import { AppLogger } from '@/logger';
import type { LoyaltyHoldRequestedPayload, OrderPlacedEvent } from '@/orders/domain/order-events';
import type { OrderRepository } from '@/orders/infrastructure/order-repository';

interface OrderCheckoutSagaState extends Record<string, unknown> {
  orderId: string;
  userId?: string;
  pointsRequested: number;
  loyaltyStatus: 'SKIPPED' | 'REQUESTED' | 'CONFIRMED' | 'FAILED';
}

export class OrderCheckoutSaga {
  private static readonly SAGA_TYPE = 'OrderCheckoutCoordinationSaga';
  private readonly log = new AppLogger('order-checkout-saga');
  private readonly uow: UnitOfWork;
  private readonly eventBus: EventBus;
  private readonly sagaRepo: PgSagaRepository;
  private readonly orderRepo: OrderRepository;

  constructor(
    uow: UnitOfWork,
    eventBus: EventBus,
    sagaRepo: PgSagaRepository,
    orderRepo: OrderRepository,
  ) {
    this.uow = uow;
    this.eventBus = eventBus;
    this.sagaRepo = sagaRepo;
    this.orderRepo = orderRepo;
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('OrderPlaced', async (event) => {
      await this.onOrderPlaced(event as unknown as OrderPlacedEvent);
    });

    eventBus.subscribe('LoyaltyHoldConfirmed', async (event) => {
      const p = event.payload as {
        readonly orderId: string;
      };
      // Persist Saga step completion inside a tight local UnitOfWork transaction
      await this.uow.transaction(async (tx) => {
        const saga = await this.sagaRepo.findOrCreate<OrderCheckoutSagaState>(
          OrderCheckoutSaga.SAGA_TYPE,
          p.orderId,
          'LOYALTY_CONFIRMED',
          {
            orderId: p.orderId,
            pointsRequested: 0,
            loyaltyStatus: 'CONFIRMED',
          },
          event.metadata.actorId,
          tx,
        );
        if (saga.status === 'COMPLETED') return;
        await this.sagaRepo.advanceStep(
          saga.id,
          saga.rowVersion,
          'COMPLETED',
          'COMPLETED',
          {
            ...saga.statePayload,
            loyaltyStatus: 'CONFIRMED',
          },
          event.metadata.actorId,
          null,
          tx,
        );
      });
    });

    eventBus.subscribe('LoyaltyHoldFailed', async (event) => {
      const p = event.payload as {
        readonly orderId: string;
        readonly reason: string;
      };
      const order = await this.orderRepo.findById(p.orderId);
      if (order && order.snapshot.status !== 'CANCELLED' && order.snapshot.status !== 'REJECTED') {
        order.cancelOrReject('CANCELLED', `Loyalty hold failed: ${p.reason}`, event.metadata);
        await this.orderRepo.save(order);
      }

      await this.uow.transaction(async (tx) => {
        const saga = await this.sagaRepo.findOrCreate<OrderCheckoutSagaState>(
          OrderCheckoutSaga.SAGA_TYPE,
          p.orderId,
          'LOYALTY_FAILED',
          {
            orderId: p.orderId,
            pointsRequested: 0,
            loyaltyStatus: 'FAILED',
          },
          event.metadata.actorId,
          tx,
        );
        if (saga.status !== 'COMPLETED' && saga.status !== 'FAILED') {
          await this.sagaRepo.advanceStep(
            saga.id,
            saga.rowVersion,
            'COMPENSATED',
            'FAILED',
            {
              ...saga.statePayload,
              loyaltyStatus: 'FAILED',
            },
            event.metadata.actorId,
            p.reason,
            tx,
          );
        }
      });

      this.log.error`Compensated order ${p.orderId} after LoyaltyHoldFailed: ${p.reason}`;
    });
  }

  private async onOrderPlaced(event: OrderPlacedEvent): Promise<void> {
    if (event.payload.loyaltyPointsHeld <= 0 || !event.payload.customerId) return;

    const actorId = event.metadata.actorId;
    // Persist RUNNING Saga state inside UnitOfWork before publishing LoyaltyHoldRequested
    const shouldPublish = await this.uow.transaction(async (tx) => {
      const saga = await this.sagaRepo.findOrCreate<OrderCheckoutSagaState>(
        OrderCheckoutSaga.SAGA_TYPE,
        event.payload.orderId,
        'REQUEST_LOYALTY_HOLD',
        {
          orderId: event.payload.orderId,
          userId: event.payload.customerId,
          pointsRequested: event.payload.loyaltyPointsHeld,
          loyaltyStatus: 'REQUESTED',
        },
        actorId,
        tx,
      );

      return saga.status === 'RUNNING';
    });

    if (!shouldPublish) return;

    // Publish LoyaltyHoldRequested strictly post-commit
    await this.eventBus.publish([
      {
        eventId: crypto.randomUUID(),
        aggregateId: event.payload.orderId,
        aggregateType: 'OrderCheckoutSaga',
        eventType: 'LoyaltyHoldRequested',
        version: 1,
        occurredAt: new Date(),
        payload: {
          orderId: event.payload.orderId,
          userId: event.payload.customerId,
          restaurantId: event.payload.restaurantId,
          issuerScope: event.payload.loyaltyWalletScope ?? 'PLATFORM',
          pointsToHold: event.payload.loyaltyPointsHeld,
          allowLoyaltyRedeem: event.payload.allowLoyaltyRedeem,
        } satisfies LoyaltyHoldRequestedPayload,
        metadata: event.metadata,
      },
    ]);
  }
}
