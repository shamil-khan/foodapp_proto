import {
  type DbExecutor,
  type DbReader,
  PgUnitOfWork,
  type Pool,
  type PoolClient,
  RestaurantTable,
  SYSTEM_ACTORS,
  type UnitOfWork,
} from '@foodapp/db';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { EventBus } from '@/core/application/event-bus';
import { InMemoryEventBus } from '@/core/application/event-bus';
import type { DomainEvent } from '@/core/domain/domain-event';
import type { PgEventStore } from '@/core/infrastructure/pg-event-store';
import { ReadRepository } from '@/core/infrastructure/read-repository';
import { OrderAggregate } from '@/orders/domain/order-aggregate';
import { OrderRepository } from '@/orders/infrastructure/order-repository';

function createFakePool() {
  const executedSql: string[] = [];
  let released = false;

  const client = {
    query: async (sql: string) => {
      executedSql.push(sql);
      return {
        rows: [],
        rowCount: 1,
      };
    },
    release: () => {
      released = true;
    },
  } as unknown as PoolClient;

  const pool = {
    connect: async () => client,
    query: async (sql: string) => {
      executedSql.push(sql);
      return {
        rows: [],
        rowCount: 0,
      };
    },
  } as unknown as Pool;

  return {
    pool,
    executedSql,
    isReleased: () => released,
  };
}

describe('shared.unit-of-work-read-repo — UnitOfWork, ReadRepository & Post-Commit Publishing', () => {
  it('commits PgUnitOfWork transactions and always releases the pooled client', async () => {
    const { pool, executedSql, isReleased } = createFakePool();
    const uow = new PgUnitOfWork(pool);

    const result = await uow.transaction(async (tx) => {
      await tx.execute({
        text: 'UPDATE "Order" SET "status" = $1',
        params: [
          'ACCEPTED',
        ],
        _result: {} as Record<string, unknown>,
      });
      return 'committed-ok';
    });

    expect(result).toBe('committed-ok');
    expect(executedSql[0]).toBe('BEGIN');
    expect(executedSql[1]).toBe('UPDATE "Order" SET "status" = $1');
    expect(executedSql[2]).toBe('COMMIT');
    expect(isReleased()).toBe(true);
  });

  it('rolls back PgUnitOfWork transactions on error and still releases the pooled client', async () => {
    const { pool, executedSql, isReleased } = createFakePool();
    const uow = new PgUnitOfWork(pool);

    await expect(
      uow.transaction(async () => {
        throw new Error('simulated failure');
      }),
    ).rejects.toThrow('simulated failure');

    expect(executedSql).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(isReleased()).toBe(true);
  });

  it('applies activeOnly() deletedAt IS NULL filter automatically in ReadRepository.findById', async () => {
    let capturedSql = '';
    const fakeReader: DbReader = {
      queryOne: async (compiled) => {
        capturedSql = compiled.text;
        return null;
      },
      queryMany: async () => [],
      exists: async () => false,
    };

    const readRepo = new ReadRepository(fakeReader);
    await readRepo.findById(RestaurantTable, 'a0000000-0000-4000-8000-000000000001');

    expect(capturedSql).toContain('"deletedAt" IS NULL');
    expect(capturedSql).toContain('"id" = $1');
  });

  it('publishes domain events in OrderRepository.save strictly AFTER UnitOfWork transaction commits', async () => {
    const timeline: string[] = [];

    const uow: UnitOfWork = {
      queryOne: async () => null,
      queryMany: async () => [],
      exists: async () => false,
      execute: async () => 1,
      executeRaw: async () => 1,
      transaction: async <T>(work: (tx: DbExecutor) => Promise<T>): Promise<T> => {
        timeline.push('TX_BEGIN');
        const tx: DbExecutor = {
          queryOne: async () => null,
          queryMany: async () => [],
          exists: async () => false,
          execute: async () => {
            timeline.push('TX_PROJECTION_WRITE');
            return 1;
          },
          executeRaw: async () => 1,
        };
        const out = await work(tx);
        timeline.push('TX_COMMIT');
        return out;
      },
    };

    const eventStore = {
      appendEvents: async () => {
        timeline.push('TX_EVENT_STORE_APPEND');
      },
      loadStream: async () => ({
        events: [],
      }),
    } as unknown as PgEventStore;

    const eventBus: EventBus = {
      subscribe: () => {},
      publish: async (events: readonly DomainEvent<unknown>[]) => {
        timeline.push(`POST_COMMIT_PUBLISH:${events.map((e) => e.eventType).join(',')}`);
      },
      unsubscribe: () => {},
    };

    const repo = new OrderRepository(uow, eventStore, eventBus, {
      requestId: 'req-uow-1',
      actorId: SYSTEM_ACTORS.SYSTEM_CRON,
      actorSource: 'SYSTEM',
      permissions: [],
    });

    const aggRes = OrderAggregate.createOrder(
      'ord-uow-1',
      {
        branchId: 'branch-1',
        restaurantId: 'rest-1',
        orderSource: 'DINE_IN',
        stateMachineCode: 'STANDARD_RESTAURANT',
        paymentMode: 'CARD_TERMINAL',
        requiresOnlineCapture: false,
        lines: [
          {
            lineId: 'line-1',
            menuItemId: 'item-1',
            itemName: 'Margherita',
            quantity: 1,
            unitPriceGbp: new Decimal('10.00'),
            vatRatePercent: new Decimal('20.00'),
            allergenFlags: [],
            kdsTarget: 'KITCHEN_SCREEN',
            modifiers: [],
          },
        ],
      },
      {
        requestId: 'req-uow-1',
        actorId: SYSTEM_ACTORS.SYSTEM_CRON,
        restaurantId: 'rest-1',
      },
    );

    expect(aggRes.ok).toBe(true);
    if (!aggRes.ok) return;

    await repo.save(aggRes.value);

    const commitIdx = timeline.indexOf('TX_COMMIT');
    const publishIdx = timeline.findIndex((entry) => entry.startsWith('POST_COMMIT_PUBLISH:'));
    expect(commitIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(commitIdx);
  });
});

describe('InMemoryEventBus — Unsubscribe Cleanup', () => {
  it('removes unsubscribed handlers so transient SSE streams do not leak listeners', async () => {
    const bus = new InMemoryEventBus();
    let calls = 0;
    const listener = async () => {
      calls += 1;
    };

    bus.subscribe('OrderTransitioned', listener);
    bus.unsubscribe('OrderTransitioned', listener);

    await bus.publish([
      {
        eventId: 'evt-sse-1',
        aggregateId: 'ord-1',
        aggregateType: 'Order',
        eventType: 'OrderTransitioned',
        version: 2,
        occurredAt: new Date(),
        payload: {},
        metadata: {
          actorId: 'sys',
        },
      },
    ]);

    expect(calls).toBe(0);
  });
});
