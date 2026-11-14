import {
  type PlatformRole,
  pgPool,
  redisClient,
  SYSTEM_ACTORS,
  type TenantRole,
} from '@foodapp/db';
import type { InferdiHonoScopeEnv } from '@inferdi/hono';
import { Container } from '@inferdi/inferdi';
import { MenuCacheInvalidationHandler } from '@/contexts/catalog/application/cache-invalidation-handler';
import { UpdateMenuItemPriceHandler } from '@/contexts/catalog/application/commands';
import {
  GetRestaurantMenuSnapshotHandler,
  GetRestaurantsHandler,
} from '@/contexts/catalog/application/queries';
import { CatalogRepository } from '@/contexts/catalog/infrastructure/catalog-repository';
import { CatalogController } from '@/contexts/catalog/services/catalog-controller';
import { LoginPosStaffHandler } from '@/contexts/identity/application/pos-login-command';
import { GetCurrentActorHandler } from '@/contexts/identity/application/queries';
import { IdentityController } from '@/contexts/identity/services/identity-controller';
import {
  RecordOrderSettlementHandler,
  RedeemLoyaltyPointsHandler,
} from '@/contexts/ledger/application/commands';
import { LoyaltyPointsEventHandler } from '@/contexts/ledger/application/loyalty-event-handler';
import {
  GetRestaurantLedgerHandler,
  GetUserLoyaltyBalanceHandler,
} from '@/contexts/ledger/application/queries';
import { LedgerRepository } from '@/contexts/ledger/infrastructure/ledger-repository';
import { LedgerController } from '@/contexts/ledger/services/ledger-controller';
import {
  PlacePosOrderHandler,
  SettlePosOrderHandler,
} from '@/contexts/ordering/application/commands';
import { OrderSettlementSaga } from '@/contexts/ordering/application/order-saga';
import { GetRestaurantOrdersHandler } from '@/contexts/ordering/application/queries';
import { OrderRepository } from '@/contexts/ordering/infrastructure/order-repository';
import { OrderController } from '@/contexts/ordering/services/order-controller';
import { InMemoryCommandBus, InMemoryQueryBus } from '@/core/application/cqrs';
import { InMemoryEventBus } from '@/core/application/event-bus';
import { PgEventStore } from '@/core/infrastructure/pg-event-store';
import { PgSagaRepository } from '@/core/infrastructure/pg-saga-repository';
import { AppLogger } from '@/logger';

export type RequestContext = {
  requestId: string;
  actorId: string;
  actorSource: 'GLOBAL_USER' | 'POS_STAFF' | 'SYSTEM';
  restaurantId?: string;
  globalRole?: PlatformRole;
  tenantRole?: TenantRole;
};

const eventBus = new InMemoryEventBus();

export const rootContainer = new Container()
  .declareScopeInputs<{
    request: RequestContext;
    log: AppLogger;
  }>()
  .registerValue('db', pgPool)
  .registerValue('redis', redisClient)
  .registerValue('eventBus', eventBus)
  .registerClass(
    'eventStore',
    PgEventStore,
    [
      'db',
    ],
    'singleton',
  )
  .registerClass(
    'sagaRepo',
    PgSagaRepository,
    [
      'db',
    ],
    'singleton',
  )

  .registerClass(
    'loginPosStaffHandler',
    LoginPosStaffHandler,
    [
      'db',
    ],
    'singleton',
  )
  .registerClass(
    'orderRepo',
    OrderRepository,
    [
      'db',
      'eventStore',
      'eventBus',
    ],
    'singleton',
  )
  .registerClass(
    'catalogRepo',
    CatalogRepository,
    [
      'db',
    ],
    'singleton',
  )
  .registerClass(
    'ledgerRepo',
    LedgerRepository,
    [
      'db',
      'eventStore',
      'eventBus',
    ],
    'singleton',
  )
  .registerClass(
    'getOrdersHandler',
    GetRestaurantOrdersHandler,
    [
      'db',
    ],
    'singleton',
  )
  .registerClass(
    'getMenuSnapshotHandler',
    GetRestaurantMenuSnapshotHandler,
    [
      'catalogRepo',
      'redis',
    ],
    'singleton',
  )
  .registerClass(
    'getRestaurantLedgerHandler',
    GetRestaurantLedgerHandler,
    [
      'db',
    ],
    'singleton',
  )
  .registerClass(
    'getUserLoyaltyHandler',
    GetUserLoyaltyBalanceHandler,
    [
      'db',
    ],
    'singleton',
  )

  .registerClass(
    'orderSaga',
    OrderSettlementSaga,
    [
      'ledgerRepo',
      'sagaRepo',
    ],
    'singleton',
  )
  .registerClass(
    'menuCacheHandler',
    MenuCacheInvalidationHandler,
    [
      'catalogRepo',
      'redis',
    ],
    'singleton',
  )
  .registerClass(
    'loyaltyEventHandler',
    LoyaltyPointsEventHandler,
    [
      'ledgerRepo',
    ],
    'singleton',
  )

  .registerClass(
    'getCurrentActorHandler',
    GetCurrentActorHandler,
    [
      'db',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'placeOrderHandler',
    PlacePosOrderHandler,
    [
      'db',
      'orderRepo',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'settleOrderHandler',
    SettlePosOrderHandler,
    [
      'orderRepo',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'updateItemPriceHandler',
    UpdateMenuItemPriceHandler,
    [
      'catalogRepo',
      'eventBus',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'recordSettlementHandler',
    RecordOrderSettlementHandler,
    [
      'ledgerRepo',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'redeemLoyaltyHandler',
    RedeemLoyaltyPointsHandler,
    [
      'db',
      'ledgerRepo',
      'request',
    ],
    'scoped',
  )

  // Pre-wire request-scoped CommandBus & QueryBus with their
  .registerFactory(
    'commandBus',
    (c) => {
      const bus = new InMemoryCommandBus(c.get('log'));
      bus.register('LoginPosStaff', c.get('loginPosStaffHandler'));
      bus.register('PlacePosOrder', c.get('placeOrderHandler'));
      bus.register('SettlePosOrder', c.get('settleOrderHandler'));
      bus.register('UpdateMenuItemPrice', c.get('updateItemPriceHandler'));
      bus.register('RecordOrderSettlement', c.get('recordSettlementHandler'));
      bus.register('RedeemLoyaltyPoints', c.get('redeemLoyaltyHandler'));
      return bus;
    },
    [
      'log',
      'loginPosStaffHandler',
      'placeOrderHandler',
      'settleOrderHandler',
      'updateItemPriceHandler',
      'recordSettlementHandler',
      'redeemLoyaltyHandler',
    ],
    'scoped',
  )
  .registerFactory(
    'queryBus',
    (c) => {
      const bus = new InMemoryQueryBus();
      bus.register('GetCurrentActor', c.get('getCurrentActorHandler'));
      bus.register('GetRestaurants', c.get('getRestaurantsHandler'));
      bus.register('GetRestaurantOrders', c.get('getOrdersHandler'));
      bus.register('GetRestaurantMenuSnapshot', c.get('getMenuSnapshotHandler'));
      bus.register('GetRestaurantLedger', c.get('getRestaurantLedgerHandler'));
      bus.register('GetUserLoyaltyBalance', c.get('getUserLoyaltyHandler'));
      return bus;
    },
    [
      'getCurrentActorHandler',
      'getRestaurantsHandler',
      'getOrdersHandler',
      'getMenuSnapshotHandler',
      'getRestaurantLedgerHandler',
      'getUserLoyaltyHandler',
    ],
    'scoped',
  )

  // Constructor-injected scoped controllers
  .registerClass(
    'identityController',
    IdentityController,
    [
      'commandBus',
      'queryBus',
    ],
    'scoped',
  )
  .registerClass(
    'catalogController',
    CatalogController,
    [
      'commandBus',
      'queryBus',
    ],
    'scoped',
  )
  .registerClass(
    'orderController',
    OrderController,
    [
      'commandBus',
      'queryBus',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'ledgerController',
    LedgerController,
    [
      'commandBus',
      'queryBus',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'getRestaurantsHandler',
    GetRestaurantsHandler,
    [
      'db',
    ],
    'singleton',
  );

const bootScope = rootContainer.createScope({
  request: {
    requestId: 'bootstrap',
    actorId: SYSTEM_ACTORS.SYSTEM_CRON,
    actorSource: 'SYSTEM',
  },
  log: new AppLogger('bootstrap'),
});
bootScope.get('orderSaga').register(eventBus);
bootScope.get('menuCacheHandler').register(eventBus);
bootScope.get('loyaltyEventHandler').register(eventBus);

export type RequestScope = ReturnType<typeof rootContainer.createScope>;
export type AppEnv = InferdiHonoScopeEnv<RequestScope>;
