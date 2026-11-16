import { ALL_PERMISSIONS, pgPool, redisClient, SYSTEM_ACTORS } from '@foodapp/db';
import type { InferdiHonoScopeEnv } from '@inferdi/hono';
import { Container } from '@inferdi/inferdi';
import {
  CreateRestaurantByAdminHandler,
  UpdateRestaurantStatusByAdminHandler,
} from '@/contexts/catalog/application/admin-restaurant-commands';
import { MenuCacheInvalidationHandler } from '@/contexts/catalog/application/cache-invalidation-handler';
import { UpdateMenuItemPriceHandler } from '@/contexts/catalog/application/commands';
import {
  GetRestaurantBySubdomainHandler,
  GetRestaurantMenuSnapshotHandler,
  GetRestaurantsHandler,
} from '@/contexts/catalog/application/queries';
import { CatalogRepository } from '@/contexts/catalog/infrastructure/catalog-repository';
import { CatalogController } from '@/contexts/catalog/services/catalog-controller';
import { LoginPosStaffHandler } from '@/contexts/identity/application/pos-login-command';
import { GetCurrentActorHandler } from '@/contexts/identity/application/queries';
import {
  AssignStaffRoleHandler,
  CreateStaffRoleHandler,
  DeleteStaffRoleHandler,
  UpdateStaffRoleHandler,
} from '@/contexts/identity/application/role-commands';
import {
  GetAssignablePermissionsHandler,
  GetRestaurantStaffRolesHandler,
} from '@/contexts/identity/application/role-queries';
import { RolePermissionCache } from '@/contexts/identity/infrastructure/role-permission-cache';
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
import { AuthorizationPolicy, type RequestContext } from '@/core/application/authorization';
import { InMemoryCommandBus, InMemoryQueryBus } from '@/core/application/cqrs';
import { InMemoryEventBus } from '@/core/application/event-bus';
import { PgEventStore } from '@/core/infrastructure/pg-event-store';
import { PgSagaRepository } from '@/core/infrastructure/pg-saga-repository';
import { AppLogger } from '@/logger';

export type { RequestContext };

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
    'rolePermissionCache',
    RolePermissionCache,
    [
      'db',
      'redis',
    ],
    'singleton',
  )
  .registerClass(
    'loginPosStaffHandler',
    LoginPosStaffHandler,
    [
      'db',
      'rolePermissionCache',
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
    'getRestaurantsHandler',
    GetRestaurantsHandler,
    [
      'db',
    ],
    'singleton',
  )
  .registerClass(
    'getRestaurantBySubdomainHandler',
    GetRestaurantBySubdomainHandler,
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
    'getAssignablePermissionsHandler',
    GetAssignablePermissionsHandler,
    [],
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
    'authz',
    AuthorizationPolicy,
    [
      'request',
    ],
    'scoped',
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
    'getRestaurantStaffRolesHandler',
    GetRestaurantStaffRolesHandler,
    [
      'db',
      'authz',
    ],
    'scoped',
  )
  .registerClass(
    'createStaffRoleHandler',
    CreateStaffRoleHandler,
    [
      'db',
      'authz',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'updateStaffRoleHandler',
    UpdateStaffRoleHandler,
    [
      'db',
      'rolePermissionCache',
      'authz',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'deleteStaffRoleHandler',
    DeleteStaffRoleHandler,
    [
      'db',
      'rolePermissionCache',
      'authz',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'assignStaffRoleHandler',
    AssignStaffRoleHandler,
    [
      'db',
      'authz',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'createRestaurantByAdminHandler',
    CreateRestaurantByAdminHandler,
    [
      'db',
      'authz',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'updateRestaurantStatusByAdminHandler',
    UpdateRestaurantStatusByAdminHandler,
    [
      'db',
      'authz',
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
      'authz',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'settleOrderHandler',
    SettlePosOrderHandler,
    [
      'orderRepo',
      'authz',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'getOrdersHandler',
    GetRestaurantOrdersHandler,
    [
      'db',
      'authz',
    ],
    'scoped',
  )
  .registerClass(
    'updateItemPriceHandler',
    UpdateMenuItemPriceHandler,
    [
      'catalogRepo',
      'eventBus',
      'authz',
      'request',
    ],
    'scoped',
  )
  .registerClass(
    'getRestaurantLedgerHandler',
    GetRestaurantLedgerHandler,
    [
      'db',
      'authz',
    ],
    'scoped',
  )
  .registerClass(
    'getUserLoyaltyHandler',
    GetUserLoyaltyBalanceHandler,
    [
      'db',
      'authz',
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
      'authz',
      'request',
    ],
    'scoped',
  )
  .registerFactory(
    'commandBus',
    (c) => {
      const bus = new InMemoryCommandBus(c.get('log'), c.get('authz'));
      bus.register('LoginPosStaff', c.get('loginPosStaffHandler'));
      bus.register('CreateStaffRole', c.get('createStaffRoleHandler'), {
        requiredPermission: 'staff:roles:manage',
      });
      bus.register('UpdateStaffRole', c.get('updateStaffRoleHandler'), {
        requiredPermission: 'staff:roles:manage',
      });
      bus.register('DeleteStaffRole', c.get('deleteStaffRoleHandler'), {
        requiredPermission: 'staff:roles:manage',
      });
      bus.register('AssignStaffRole', c.get('assignStaffRoleHandler'), {
        requiredPermission: 'staff:manage',
      });
      bus.register('CreateRestaurantByAdmin', c.get('createRestaurantByAdminHandler'), {
        requiredPermission: 'platform:restaurants:manage',
      });
      bus.register('UpdateRestaurantStatusByAdmin', c.get('updateRestaurantStatusByAdminHandler'), {
        requiredPermission: 'platform:restaurants:manage',
      });
      bus.register('PlacePosOrder', c.get('placeOrderHandler'), {
        requiredPermission: 'orders:place',
      });
      bus.register('SettlePosOrder', c.get('settleOrderHandler'), {
        requiredPermission: 'orders:settle',
      });
      bus.register('UpdateMenuItemPrice', c.get('updateItemPriceHandler'), {
        requiredPermission: 'catalog:price:update',
      });
      bus.register('RecordOrderSettlement', c.get('recordSettlementHandler'));
      bus.register('RedeemLoyaltyPoints', c.get('redeemLoyaltyHandler'), {
        requiredPermission: 'loyalty:redeem',
      });
      return bus;
    },
    [
      'log',
      'authz',
      'loginPosStaffHandler',
      'createStaffRoleHandler',
      'updateStaffRoleHandler',
      'deleteStaffRoleHandler',
      'assignStaffRoleHandler',
      'createRestaurantByAdminHandler',
      'updateRestaurantStatusByAdminHandler',
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
      const bus = new InMemoryQueryBus(c.get('authz'));
      bus.register('GetCurrentActor', c.get('getCurrentActorHandler'));
      bus.register('GetRestaurants', c.get('getRestaurantsHandler'));
      bus.register('GetRestaurantBySubdomain', c.get('getRestaurantBySubdomainHandler'));
      bus.register('GetRestaurantMenuSnapshot', c.get('getMenuSnapshotHandler'));
      bus.register('GetAssignablePermissions', c.get('getAssignablePermissionsHandler'), {
        requiredPermission: 'staff:roles:manage',
      });
      bus.register('GetRestaurantStaffRoles', c.get('getRestaurantStaffRolesHandler'), {
        requiredPermission: 'staff:roles:manage',
      });
      bus.register('GetRestaurantOrders', c.get('getOrdersHandler'), {
        requiredPermission: 'orders:read',
      });
      bus.register('GetRestaurantLedger', c.get('getRestaurantLedgerHandler'), {
        requiredPermission: 'ledger:read',
      });
      bus.register('GetUserLoyaltyBalance', c.get('getUserLoyaltyHandler'), {
        requiredPermission: 'loyalty:read',
      });
      return bus;
    },
    [
      'authz',
      'getCurrentActorHandler',
      'getRestaurantsHandler',
      'getRestaurantBySubdomainHandler',
      'getMenuSnapshotHandler',
      'getAssignablePermissionsHandler',
      'getRestaurantStaffRolesHandler',
      'getOrdersHandler',
      'getRestaurantLedgerHandler',
      'getUserLoyaltyHandler',
    ],
    'scoped',
  )
  .registerClass(
    'identityController',
    IdentityController,
    [
      'commandBus',
      'queryBus',
      'request',
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
  );

const bootScope = rootContainer.createScope({
  request: {
    requestId: 'bootstrap',
    actorId: SYSTEM_ACTORS.SYSTEM_CRON,
    actorSource: 'SYSTEM',
    permissions: ALL_PERMISSIONS,
  },
  log: new AppLogger('bootstrap'),
});
bootScope.get('orderSaga').register(eventBus);
bootScope.get('menuCacheHandler').register(eventBus);
bootScope.get('loyaltyEventHandler').register(eventBus);

export type RequestScope = ReturnType<typeof rootContainer.createScope>;
export type AppEnv = InferdiHonoScopeEnv<RequestScope>;
