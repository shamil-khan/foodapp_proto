import * as crypto from 'node:crypto';
import type { UnitOfWork } from '@foodapp/db';
import type { EventBus } from '@/core/application/event-bus';
import type { PgSagaRepository } from '@/core/infrastructure/pg-saga-repository';
import { AppLogger } from '@/logger';
import type { NotificationPort } from '@/orders/application/notification-port';
import type {
  OrderSettledEvent,
  OrderSettlementFinancialsRequestedPayload,
  OrderTransitionedEvent,
} from '@/orders/domain/order-events';

interface OrderSettlementSagaState extends Record<string, unknown> {
  orderId: string;
  branchId: string;
  restaurantId: string;
  billingRequested: boolean;
}

export class OrderSettlementSaga {
  private static readonly SAGA_TYPE = 'OrderBillingSettlementSaga';
  private readonly log = new AppLogger('order-saga');
  private readonly uow: UnitOfWork;
  private readonly eventBus: EventBus;
  private readonly sagaRepo: PgSagaRepository;
  private readonly notifier: NotificationPort;

  constructor(
    uow: UnitOfWork,
    eventBus: EventBus,
    sagaRepo: PgSagaRepository,
    notifier: NotificationPort,
  ) {
    this.uow = uow;
    this.eventBus = eventBus;
    this.sagaRepo = sagaRepo;
    this.notifier = notifier;
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('OrderSettled', async (event) => {
      await this.onOrderSettled(event as unknown as OrderSettledEvent);
    });

    eventBus.subscribe('OrderTransitioned', async (event) => {
      await this.onOrderTransitioned(event as unknown as OrderTransitionedEvent);
    });
  }

  private async onOrderSettled(event: OrderSettledEvent): Promise<void> {
    const actorId = event.metadata.actorId;
    const saga = await this.uow.transaction((tx) =>
      this.sagaRepo.findOrCreate<OrderSettlementSagaState>(
        OrderSettlementSaga.SAGA_TYPE,
        event.payload.orderId,
        'REQUEST_DOUBLE_ENTRY_BILLING',
        {
          orderId: event.payload.orderId,
          branchId: event.payload.branchId,
          restaurantId: event.payload.restaurantId,
          billingRequested: false,
        },
        actorId,
        tx,
      ),
    );

    if (saga.status === 'COMPLETED') return;

    try {
      // Publish double-entry billing request before advancing Saga step to COMPLETED
      await this.eventBus.publish([
        {
          eventId: crypto.randomUUID(),
          aggregateId: event.payload.orderId,
          aggregateType: 'OrderSettlementSaga',
          eventType: 'OrderSettlementFinancialsRequested',
          version: 1,
          occurredAt: new Date(),
          payload: {
            orderId: event.payload.orderId,
            branchId: event.payload.branchId,
            restaurantId: event.payload.restaurantId,
            customerId: event.payload.customerId,
            paymentMode: event.payload.paymentMode,
            gatewayReference: event.payload.gatewayReference,
            subtotalGbp: event.payload.subtotalGbp,
            vatGbp: event.payload.vatTotalGbp,
            deliveryFeeGbp: event.payload.deliveryFeeGbp,
            loyaltyDiscountGbp: event.payload.loyaltyDiscountGbp,
            allowLoyaltyEarn: event.payload.allowLoyaltyEarn,
          } satisfies OrderSettlementFinancialsRequestedPayload,
          metadata: event.metadata,
        },
      ]);

      await this.uow.transaction((tx) =>
        this.sagaRepo.advanceStep(
          saga.id,
          saga.rowVersion,
          'COMPLETED',
          'COMPLETED',
          {
            ...saga.statePayload,
            billingRequested: true,
          },
          actorId,
          null,
          tx,
        ),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown billing saga error';
      await this.uow.transaction((tx) =>
        this.sagaRepo.advanceStep(
          saga.id,
          saga.rowVersion,
          'BILLING_REQUEST_FAILED',
          'FAILED',
          saga.statePayload,
          actorId,
          message,
          tx,
        ),
      );
      this.log.error`OrderBillingSettlementSaga failed for ${event.payload.orderId}: ${message}`;
      throw error;
    }
  }

  private async onOrderTransitioned(event: OrderTransitionedEvent): Promise<void> {
    if (!event.payload.customerId) return;

    await this.notifier.notifyCustomerOrderStatus({
      userId: event.payload.customerId,
      orderId: event.payload.orderId,
      branchId: event.payload.branchId,
      status: event.payload.toStatus,
      title: `Order ${event.payload.toStatus.replaceAll('_', ' ')}`,
      body: `Your order status is now ${event.payload.toStatus}.`,
      deepLink: `foodapp://orders/${event.payload.orderId}`,
      occurredAt: event.occurredAt.toISOString(),
    });
  }
}
