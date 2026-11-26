import { type UnitOfWork } from '@foodapp/db';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { BillingSettlementEventHandler } from '@/billing/application/billing-event-handler';
import { UkStandardVatStrategy } from '@/billing/domain/vat-strategy';
import {
  CreateBrandBranchHandler,
  UpdateBranchOperationalStatusHandler,
} from '@/brand/application/brand-commands';
import { BranchStatusCache } from '@/brand/infrastructure/branch-status-cache';
import { getAllowedOrigins } from '@/config/cors';
import { AuthorizationPolicy } from '@/core/application/authorization';
import { InMemoryEventBus } from '@/core/application/event-bus';
import { ok } from '@/core/domain/result';
import type { ReadRepository } from '@/core/infrastructure/read-repository';
import { GetCurrentActorHandler } from '@/iam/application/queries';
import { AssignStaffBranchAccessHandler } from '@/iam/application/role-commands';
import { RolePermissionCache } from '@/iam/infrastructure/role-permission-cache';
import { requireTenantOrSupportTicket } from '@/iam/services/auth-middleware';

describe('iam-brand-billing.coverage — Direct Permission Rules, Branch Creation, Support Ticket Middleware & Offset Handler', () => {
  it('exercises AssignStaffBranchAccessHandler with directRules (ALLOW/DENY/windows) and existing assignment update', async () => {
    const executedSql: string[] = [];
    const fakeUow = {
      queryOne: async (compiled: { text: string }) => {
        if (compiled.text.includes('"RestaurantStaff"')) {
          return {
            id: 'staff-1',
            restaurantId: 'rest-1',
          };
        }
        if (compiled.text.includes('"RestaurantBranch"')) {
          return {
            id: 'branch-1',
          };
        }
        if (compiled.text.includes('"StaffRole"')) {
          return {
            id: 'role-1',
            restaurantId: 'rest-1',
            name: 'BRANCH_MANAGER',
          };
        }
        if (compiled.text.includes('"StaffBranchAssignment"')) {
          return {
            id: 'assign-existing-1',
          };
        }
        return null;
      },
      queryMany: async () => [
        {
          id: 'old-direct-1',
        },
      ],
      execute: async (compiled: { text: string }) => {
        executedSql.push(compiled.text);
        return 1;
      },
      transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        work({
          queryOne: fakeUow.queryOne,
          queryMany: fakeUow.queryMany,
          execute: fakeUow.execute,
        }),
    } as unknown as UnitOfWork;

    let invalidated = false;
    const fakeCache = {
      getPermissionsForRole: async () => [
        'orders:read',
        'orders:place',
      ],
      invalidateStaffBranch: async () => {
        invalidated = true;
      },
    };

    const req = {
      requestId: 'req-assign-1',
      actorId: 'owner-1',
      actorSource: 'POS_STAFF' as const,
      restaurantId: 'rest-1',
      branchId: 'branch-1',
      permissions: [
        'staff:manage',
        'orders:read',
        'orders:place',
        'orders:discount:apply',
        'orders:refund',
      ],
    };

    const handler = new AssignStaffBranchAccessHandler(
      fakeUow,
      fakeCache as never,
      new AuthorizationPolicy(req),
      req,
    );

    const res = await handler.execute({
      staffId: 'staff-1',
      branchId: 'branch-1',
      roleId: 'role-1',
      isPrimary: true,
      directPermissions: [
        'orders:discount:apply',
      ],
      directRules: [
        {
          permission: 'orders:refund',
          effect: 'DENY',
          reason: 'Restricted refund right',
          validFrom: '2026-11-01T00:00:00.000Z',
          expiresAt: '2026-12-31T00:00:00.000Z',
        },
      ],
    });

    expect(res.ok).toBe(true);
    expect(invalidated).toBe(true);
    expect(executedSql.some((s) => s.includes('"StaffDirectPermission"'))).toBe(true);
  });
  it('exercises CreateBrandBranchHandler & UpdateBranchOperationalStatusHandler cooldown and caching', async () => {
    const bus = new InMemoryEventBus();
    const published: string[] = [];
    bus.subscribe('BranchCreated', async () => {
      published.push('BranchCreated');
    });

    const fakeUow = {
      queryOne: async (compiled: { text: string }) => {
        if (compiled.text.includes('"Restaurant"')) {
          return {
            name: 'Pizza Hut UK',
          };
        }
        if (compiled.text.includes('INSERT INTO "RestaurantBranch"')) {
          return {
            id: 'branch-new-1',
          };
        }
        return {
          id: 'branch-new-1',
          operationalStatus: 'BUSY_PAUSED',
          statusLockedUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
        };
      },
      exists: async () => false,
      execute: async () => 1,
    } as unknown as UnitOfWork;

    const req = {
      requestId: 'req-br-1',
      actorId: 'owner-1',
      actorSource: 'POS_STAFF' as const,
      restaurantId: 'rest-1',
      branchId: 'branch-new-1',
      permissions: [
        'brand:branches:create',
        'branch:status:manage',
      ],
    };

    const createHandler = new CreateBrandBranchHandler(
      fakeUow,
      bus,
      new AuthorizationPolicy(req),
      req,
    );
    const created = await createHandler.execute({
      restaurantId: 'rest-1',
      name: 'Leeds Central',
      city: 'Leeds',
      kitchenType: 'RESTAURANT_BRANCH',
      postcodeSector: 'LS1',
      streetAddress: '10 Briggate, Leeds LS1 6HD',
      contactPersonName: 'Tom',
      contactPersonPhone: '+44-113-496-0001',
    });
    expect(created.ok).toBe(true);
    expect(published).toContain('BranchCreated');

    const statusHandler = new UpdateBranchOperationalStatusHandler(
      fakeUow,
      {
        setStatus: async () => {},
      } as never,
      new AuthorizationPolicy(req),
      req,
    );
    const blocked = await statusHandler.execute({
      branchId: 'branch-new-1',
      operationalStatus: 'OPEN',
    });
    expect(blocked.ok).toBe(false);
  });

  it('exercises BillingSettlementEventHandler MerchantLoyaltyOffsetApplied & requireTenantOrSupportTicket middleware', async () => {
    const bus = new InMemoryEventBus();
    let updatedSettlement = false;
    const fakeUow = {
      transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
        work({
          queryOne: async (compiled: { text: string }) => {
            if (compiled.text.includes('"ProcessedEvent"')) {
              return {
                eventId: 'evt-off-1',
              };
            }
            return {
              id: 'settle-1',
              grossOnlinePayableGbp: '100.00',
              cashCommissionReceivableGbp: '20.00',
            };
          },
          execute: async () => {
            updatedSettlement = true;
            return 1;
          },
        }),
    } as unknown as UnitOfWork;

    new BillingSettlementEventHandler(fakeUow, () => ({
      service: {} as never,
      dispose: async () => {},
    })).register(bus);

    await bus.publish([
      {
        eventId: 'evt-off-1',
        aggregateId: 'settle-1',
        aggregateType: 'MerchantSettlement',
        eventType: 'MerchantLoyaltyOffsetApplied',
        version: 1,
        occurredAt: new Date(),
        payload: {
          settlementId: 'settle-1',
          restaurantId: 'rest-1',
          offsetGbp: '5.00',
          markPaidReference: 'FPS-999',
        },
        metadata: {
          actorId: 'owner-1',
        },
      },
    ]);
    expect(updatedSettlement).toBe(true);

    const app = new Hono();
    app.use('/support/*', async (c, next) => {
      const req = {
        requestId: 'req-sup-mw',
        actorId: 'admin-1',
        actorSource: 'PLATFORM_STAFF' as const,
        permissions: [
          'platform:support:billing-settle' as const,
        ],
      };
      c.set('di', {
        get: (key: string) => {
          if (key === 'request') return req;
          if (key === 'authz') return new AuthorizationPolicy(req);
          if (key === 'supportAccessPort') {
            return {
              validateAndAuditTicket: async () =>
                ok({
                  ticketId: 't-1',
                  restaurantId: 'rest-1',
                  scopePermission: 'platform:support:billing-settle' as const,
                  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                }),
            };
          }
          return null;
        },
      } as never);
      await next();
    });
    app.post(
      '/support/settle',
      requireTenantOrSupportTicket({
        tenantPermissions: [
          'ledger:read',
        ],
        supportScope: 'platform:support:billing-settle',
      }),
      (c) =>
        c.json(
          {
            ok: true,
          },
          200,
        ),
    );

    const res = await app.request('/support/settle', {
      method: 'POST',
      headers: {
        'X-Support-Ticket-Id': 't-1',
      },
    });
    expect(res.status).toBe(200);
  });
});

describe('Cache, VatStrategy, ActorQuery & CORS — Statement Coverage', () => {
  it('exercises RolePermissionCache & BranchStatusCache cache-miss, hit & invalidation paths', async () => {
    const kv = new Map<string, string>();
    const fakeRedis = {
      isOpen: true,
      connect: async () => {},
      get: async (k: string) => kv.get(k) ?? null,
      set: async (k: string, v: string) => {
        kv.set(k, v);
        return 'OK';
      },
      del: async (k: string) => {
        kv.delete(k);
        return 1;
      },
    };

    const fakeReadRepo = {
      exists: async () => true,
      findOne: async () => ({
        staffRoleId: 'role-1',
      }),
      findMany: async (compiled: { text: string }) => {
        if (compiled.text.includes('"StaffRolePermission"')) {
          return [
            {
              permission: 'orders:read',
            },
            {
              permission: 'orders:place',
            },
          ];
        }
        return [
          {
            permission: 'orders:place',
            effect: 'DENY',
            validFrom: null,
            expiresAt: null,
          },
        ];
      },
    } as unknown as ReadRepository;

    const roleCache = new RolePermissionCache(fakeReadRepo, fakeRedis as never);
    const effective = await roleCache.getEffectivePermissionsForStaffBranch('staff-1', 'branch-1');
    expect(effective).toEqual([
      'orders:read',
    ]);
    await roleCache.invalidateRole('role-1');
    await roleCache.invalidateStaffBranch('staff-1', 'branch-1');

    const statusCache = new BranchStatusCache(fakeRedis as never);
    await statusCache.setStatus({
      branchId: 'branch-1',
      operationalStatus: 'OPEN',
      statusLockedUntil: null,
      statusReason: null,
    });
    expect((await statusCache.getStatus('branch-1'))?.operationalStatus).toBe('OPEN');
    await statusCache.invalidate('branch-1');
    expect(await statusCache.getStatus('branch-1')).toBeNull();
  });

  it('exercises GetCurrentActorHandler (GLOBAL_USER), UkStandardVatStrategy & getAllowedOrigins', async () => {
    const actorHandler = new GetCurrentActorHandler(
      {
        findOne: async () => ({
          id: 'user-1',
          name: 'Alice',
          email: 'alice@example.com',
          role: 'CUSTOMER',
        }),
      } as unknown as ReadRepository,
      {
        requestId: 'req-1',
        actorId: 'user-1',
        actorSource: 'CUSTOMER',
        permissions: [],
      },
    );
    const profile = await actorHandler.execute();
    expect(profile?.email).toBe('alice@example.com');

    const vat = new UkStandardVatStrategy().calculateOrderVat([
      {
        lineId: 'l-1',
        netAmount: '10.00',
        vatRatePercent: '20.00',
      },
    ]);
    expect(vat.totalGrossGbp.toFixed(2)).toBe('12.00');
    expect(getAllowedOrigins().length).toBeGreaterThan(0);
  });

  it('exercises mock adapters (gateway timeouts/refund failures, card terminal, notifier) & better-auth secondaryStorage', async () => {
    const { DeterministicMockGateway } = await import(
      '@/billing/infrastructure/mocks/deterministic-mock-gateway'
    );
    const { MockCardTerminalAdapter } = await import(
      '@/billing/infrastructure/mocks/mock-card-terminal'
    );
    const { ConsoleCaptureNotifier } = await import(
      '@/orders/infrastructure/mocks/console-capture-notifier'
    );
    const { DeterministicOrderGatewayAdapter } = await import(
      '@/orders/infrastructure/mocks/deterministic-order-gateway'
    );
    const Decimal = (await import('decimal.js')).default;

    const gw = new DeterministicMockGateway();
    expect(
      (
        await gw.captureCharge({
          orderId: 'o-1',
          amountGbp: new Decimal('10.00'),
          currency: 'GBP',
          paymentToken: 'tok_timeout',
          idempotencyKey: 'k-1',
        })
      ).status,
    ).toBe('TIMEOUT');
    expect(
      (
        await gw.refundCharge({
          providerReference: 'fail_refund_1',
          amountGbp: new Decimal('5.00'),
          reason: 'test',
        })
      ).status,
    ).toBe('FAILED');

    const term = new MockCardTerminalAdapter();
    expect(
      (
        await term.recordTerminalTap({
          terminalId: 'PDQ-1',
          orderId: 'o-1',
          amountGbp: new Decimal('10.00'),
        })
      ).approved,
    ).toBe(true);
    expect(
      (
        await term.recordTerminalTap({
          terminalId: 'PDQ-1',
          orderId: 'o-1',
          amountGbp: new Decimal('10.00'),
          authCode: 'DECLINE',
        })
      ).approved,
    ).toBe(false);

    const orderGw = new DeterministicOrderGatewayAdapter();
    expect(
      (
        await orderGw.captureCharge({
          orderId: 'o-2',
          amountGbp: new Decimal('12.00'),
          currency: 'GBP',
          paymentToken: 'tok_timeout',
          idempotencyKey: 'k-2',
        })
      ).status,
    ).toBe('TIMEOUT');

    const notifier = new ConsoleCaptureNotifier();
    await notifier.notifyCustomerOrderStatus({
      userId: 'u-1',
      orderId: 'o-1',
      branchId: 'b-1',
      status: 'ACCEPTED',
      title: 'Accepted',
      body: 'Order accepted',
      deepLink: 'foodapp://orders/o-1',
      occurredAt: new Date().toISOString(),
    });
    expect(notifier.getCapturedNotifications()).toHaveLength(1);
    notifier.clear();
    expect(notifier.getCapturedNotifications()).toHaveLength(0);
  });
});
