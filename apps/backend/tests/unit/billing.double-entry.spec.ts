import { SYSTEM_ACTORS, type UnitOfWork } from '@foodapp/db';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { BillingSettlementEventHandler } from '@/billing/application/billing-event-handler';
import { BillingSettlementService, RefundOrderHandler } from '@/billing/application/commands';
import { FinancialLedgerAggregate } from '@/billing/domain/billing-aggregate';
import type { BillingSettlementRecordedPayload } from '@/billing/domain/billing-events';
import { BillingRepository } from '@/billing/infrastructure/billing-repository';
import { DeterministicMockGateway } from '@/billing/infrastructure/mocks/deterministic-mock-gateway';
import { AuthorizationPolicy } from '@/core/application/authorization';
import { InMemoryEventBus } from '@/core/application/event-bus';
import { money } from '@/core/domain/money';

describe('billing.double-entry — Balanced Debits/Credits & UK Commission VAT', () => {
  it('maintains SUM(debit) === SUM(credit) for ONLINE_GATEWAY with loyalty discount subsidy', () => {
    const ledger = FinancialLedgerAggregate.create('rest-uk-1');
    const res = ledger.recordOrderSettlement(
      {
        orderId: 'ord-uk-100',
        branchId: 'branch-uk-1',
        restaurantId: 'rest-uk-1',
        customerId: 'cust-uk-1',
        paymentMode: 'ONLINE_GATEWAY',
        subtotalGbp: new Decimal('30.00'),
        vatGbp: new Decimal('6.00'),
        deliveryFeeGbp: new Decimal('2.50'),
        loyaltyDiscountGbp: new Decimal('3.00'),
        commissionRatePercent: new Decimal('15.00'),
        commissionVatGbp: new Decimal('0.90'),
        allowLoyaltyEarn: true,
      },
      {
        actorId: 'system',
        restaurantId: 'rest-uk-1',
      },
    );

    expect(res.ok).toBe(true);
    const events = ledger.pullDomainEvents();
    expect(events).toHaveLength(1);

    const payload = events[0]?.payload as BillingSettlementRecordedPayload;
    let totalDebit = money(0);
    let totalCredit = money(0);
    for (const line of payload.journalLines) {
      if (line.side === 'DEBIT') totalDebit = totalDebit.plus(line.amountGbp);
      if (line.side === 'CREDIT') totalCredit = totalCredit.plus(line.amountGbp);
    }

    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
    expect(ledger.snapshot.merchantPayableGbp).toBe('33.10');
  });

  it('posts balanced CASH_COMMISSION_RECEIVABLE entries on CASH orders', () => {
    const ledger = FinancialLedgerAggregate.create('rest-uk-2');
    const res = ledger.recordOrderSettlement(
      {
        orderId: 'ord-uk-200',
        branchId: 'branch-uk-2',
        restaurantId: 'rest-uk-2',
        paymentMode: 'CASH',
        subtotalGbp: new Decimal('20.00'),
        vatGbp: new Decimal('4.00'),
        deliveryFeeGbp: new Decimal('0.00'),
        loyaltyDiscountGbp: new Decimal('0.00'),
        commissionRatePercent: new Decimal('12.50'),
        commissionVatGbp: new Decimal('0.50'),
        allowLoyaltyEarn: false,
      },
      {
        actorId: 'system',
        restaurantId: 'rest-uk-2',
      },
    );

    expect(res.ok).toBe(true);
    const events = ledger.pullDomainEvents();
    const payload = events[0]?.payload as BillingSettlementRecordedPayload;
    let totalDebit = money(0);
    let totalCredit = money(0);
    for (const line of payload.journalLines) {
      if (line.side === 'DEBIT') totalDebit = totalDebit.plus(line.amountGbp);
      if (line.side === 'CREDIT') totalCredit = totalCredit.plus(line.amountGbp);
    }

    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
    expect(ledger.snapshot.cashCommissionReceivableGbp).toBe('3.00');
  });
});

// Append to apps/backend/tests/unit/billing.double-entry.spec.ts
describe('RefundOrderHandler — Restaurant Scope Resolution', () => {
  it('resolves restaurantId from RestaurantBranch when request.restaurantId is absent', async () => {
    let recordedRestaurantId = '';
    const fakeUow = {
      queryOne: async (compiled: { text: string }) => {
        if (compiled.text.includes('"Order"')) {
          return {
            id: 'order-1',
            branchId: 'branch-1',
            totalAmount: '25.00',
            idempotencyKey: 'uk_gw_1',
          };
        }
        if (compiled.text.includes('"RestaurantBranch"')) {
          return {
            restaurantId: 'rest-resolved-999',
          };
        }
        return null;
      },
      queryMany: async () => [],
      transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        work({
          executeRaw: async () => 1,
          queryMany: fakeUow.queryMany,
        }),
    } as unknown as UnitOfWork;

    const fakeRepo = {
      appendJournalLines: async (params: { restaurantId: string }) => {
        recordedRestaurantId = params.restaurantId;
      },
    };

    const req = {
      requestId: 'req-ref-1',
      actorId: SYSTEM_ACTORS.SYSTEM_CRON,
      actorSource: 'SYSTEM' as const,
      permissions: [],
    };
    const handler = new RefundOrderHandler(
      fakeUow,
      fakeRepo as never,
      new DeterministicMockGateway(),
      new AuthorizationPolicy(req),
      req,
    );

    const res = await handler.execute({
      orderId: 'ord-1',
      amountGbp: '10.00',
      reason: 'Customer cold food refund',
    });

    expect(res.ok).toBe(true);
    expect(recordedRestaurantId).toBe('rest-resolved-999');
  });
});

describe('BillingSettlementEventHandler — Atomic ProcessedEvent Claim', () => {
  it('claims ProcessedEvent inside uow.transaction so a handler failure does not permanently drop retries', async () => {
    let claimedOutsideTx = false;
    const bus = new InMemoryEventBus();

    const fakeUow = {
      queryOne: async () => {
        claimedOutsideTx = true;
        return {
          eventId: 'evt-1',
        };
      },
      transaction: async (work: (tx: unknown) => Promise<unknown>) =>
        work({
          queryOne: async () => ({
            eventId: 'evt-1',
          }),
          execute: async () => 1,
        }),
    } as unknown as UnitOfWork;

    const fakeService = {
      recordOrderFinancials: async () => ({
        ok: true as const,
        value: [],
      }),
    };

    new BillingSettlementEventHandler(fakeUow, fakeService as never).register(bus);

    await bus.publish([
      {
        eventId: 'evt-1',
        aggregateId: 'ord-1',
        aggregateType: 'Order',
        eventType: 'OrderSettlementFinancialsRequested',
        version: 1,
        occurredAt: new Date(),
        payload: {
          orderId: 'ord-1',
          branchId: 'b-1',
          restaurantId: 'r-1',
          paymentMode: 'CASH',
          subtotalGbp: '10.00',
          vatGbp: '2.00',
          deliveryFeeGbp: '0.00',
          loyaltyDiscountGbp: '0.00',
          allowLoyaltyEarn: true,
        },
        metadata: {
          actorId: 'sys',
        },
      },
    ]);

    expect(claimedOutsideTx).toBe(false);
  });
});

describe('BillingSettlementEventHandler & RefundOrderHandler — Post-Commit & Cumulative Refund Guards', () => {
  it('publishes BillingSettlementRecorded strictly AFTER outer uow.transaction commits', async () => {
    const timeline: string[] = [];
    const bus = new InMemoryEventBus();
    bus.subscribe('BillingSettlementRecorded', async () => {
      timeline.push('EVENT_PUBLISHED');
    });

    const fakeUow = {
      queryOne: async () => ({
        platformFeeRate: '15.00',
      }),

      queryMany: async () => [],
      transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
        timeline.push('TX_BEGIN');
        const tx = {
          queryOne: async () => ({
            eventId: 'evt-post-1',
          }),
          queryMany: async () => [],
          execute: async () => {
            timeline.push('TX_WRITE');
            return 1;
          },
        };
        const out = await work(tx);
        timeline.push('TX_COMMIT');
        return out;
      },
    } as unknown as UnitOfWork;

    const req = {
      requestId: 'req-1',
      actorId: SYSTEM_ACTORS.SYSTEM_CRON,
      actorSource: 'SYSTEM' as const,
      permissions: [],
    };
    const repo = new BillingRepository(fakeUow, req);
    const service = new BillingSettlementService(fakeUow, repo, bus);
    new BillingSettlementEventHandler(fakeUow, service).register(bus);

    await bus.publish([
      {
        eventId: 'evt-post-1',
        aggregateId: 'ord-1',
        aggregateType: 'Order',
        eventType: 'OrderSettlementFinancialsRequested',
        version: 1,
        occurredAt: new Date(),
        payload: {
          orderId: 'ord-1',
          branchId: 'b-1',
          restaurantId: 'r-1',
          paymentMode: 'ONLINE_GATEWAY',
          subtotalGbp: '20.00',
          vatGbp: '4.00',
          deliveryFeeGbp: '0.00',
          loyaltyDiscountGbp: '0.00',
          allowLoyaltyEarn: true,
        },
        metadata: {
          actorId: 'sys',
        },
      },
    ]);

    expect(timeline.indexOf('EVENT_PUBLISHED')).toBeGreaterThan(timeline.indexOf('TX_COMMIT'));
  });

  it('rejects partial refunds when cumulative refunded amount exceeds order totalAmount', async () => {
    const fakeUow = {
      queryOne: async (compiled: { text: string }) => {
        if (compiled.text.includes('"Order"')) {
          return {
            id: 'ord-2',
            branchId: 'branch-1',
            totalAmount: '20.00',
            idempotencyKey: 'uk_gw_2',
          };
        }
        return null;
      },
      queryMany: async () => [
        {
          debitAmount: '15.00',
        },
      ],
      transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        work({
          executeRaw: async () => 1,
          queryMany: fakeUow.queryMany,
        }),
    } as unknown as UnitOfWork;

    const req = {
      requestId: 'req-ref-2',
      actorId: SYSTEM_ACTORS.SYSTEM_CRON,
      actorSource: 'SYSTEM' as const,
      restaurantId: 'rest-1',
      permissions: [],
    };
    const handler = new RefundOrderHandler(
      fakeUow,
      {
        appendJournalLines: async () => {},
      } as never,
      new DeterministicMockGateway(),
      new AuthorizationPolicy(req),
      req,
    );

    const res = await handler.execute({
      orderId: 'ord-2',
      amountGbp: '10.00',
      reason: 'Second partial refund exceeding £20 total',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_REFUND');
  });
});
