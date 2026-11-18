import { ALL_PERMISSIONS } from '@foodapp/db';
import type { EventBus } from '@/core/application/event-bus';
import type { PgSagaRepository } from '@/core/infrastructure/pg-saga-repository';
import { RecordOrderSettlementHandler } from '@/ledger/application/commands';
import type { LedgerRepository } from '@/ledger/infrastructure/ledger-repository';
import type { PosOrderSettledEvent } from '@/ordering/domain/order-events';

interface OrderSettlementSagaState extends Record<string, unknown> {
  orderId: string;
  restaurantId: string;
  finalTotal: number;
  ledgerId?: string;
  ledgerRecorded: boolean;
}

export class OrderSettlementSaga {
  private static readonly SAGA_TYPE = 'OrderSettlementSaga';
  private readonly ledgerRepo: LedgerRepository;
  private readonly sagaRepo: PgSagaRepository;

  constructor(ledgerRepo: LedgerRepository, sagaRepo: PgSagaRepository) {
    this.ledgerRepo = ledgerRepo;
    this.sagaRepo = sagaRepo;
  }

  public register(eventBus: EventBus): void {
    eventBus.subscribe('PosOrderSettled', async (event) => {
      await this.onOrderSettled(event as unknown as PosOrderSettledEvent);
    });
  }

  private async onOrderSettled(event: PosOrderSettledEvent): Promise<void> {
    const actorId = event.metadata.actorId;
    const saga = await this.sagaRepo.findOrCreate<OrderSettlementSagaState>(
      OrderSettlementSaga.SAGA_TYPE,
      event.aggregateId,
      'RECORD_FINANCIAL_LEDGER',
      {
        orderId: event.aggregateId,
        restaurantId: event.payload.restaurantId,
        finalTotal: event.payload.finalTotal,
        ledgerRecorded: false,
      },
      actorId,
    );

    if (saga.status === 'COMPLETED') return;

    try {
      const handler = new RecordOrderSettlementHandler(this.ledgerRepo, {
        requestId: event.metadata.requestId ?? `saga-${saga.id}`,
        actorId,
        actorSource: 'SYSTEM',
        restaurantId: event.payload.restaurantId,
        permissions: ALL_PERMISSIONS,
      });

      const result = await handler.execute({
        orderId: event.aggregateId,
        restaurantId: event.payload.restaurantId,
        subtotal: event.payload.subtotal,
        vatTotal: event.payload.vatTotal,
        tipAmount: event.payload.tipAmount,
        totalAmount: event.payload.finalTotal,
      });

      if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.message}`);
      }

      await this.sagaRepo.advanceStep(
        saga.id,
        saga.rowVersion,
        'COMPLETED',
        'COMPLETED',
        {
          ...saga.statePayload,
          ledgerId: result.value.ledgerId,
          ledgerRecorded: true,
        },
        actorId,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown Saga failure';
      await this.sagaRepo.advanceStep(
        saga.id,
        saga.rowVersion,
        'COMPENSATING_LEDGER',
        'FAILED',
        saga.statePayload,
        actorId,
        message,
      );
      throw error;
    }
  }
}
