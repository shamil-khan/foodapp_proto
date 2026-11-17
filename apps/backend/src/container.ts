import { ALL_PERMISSIONS, pgPool, redisClient, SYSTEM_ACTORS } from '@foodapp/db';
import type { InferdiHonoScopeEnv } from '@inferdi/hono';
import { Container } from '@inferdi/inferdi';
import {
  CreateRestaurantByAdminHandler,
  UpdateRestaurantStatusByAdminHandler,
} from '@/catalog/application/admin-restaurant-commands';
import { MenuCacheInvalidationHandler } from '@/catalog/application/cache-invalidation-handler';
import { UpdateMenuItemPriceHandler } from '@/catalog/application/commands';
import {
  GetRestaurantBySubdomainHandler,
  GetRestaurantMenuSnapshotHandler,
  GetRestaurantsHandler,
} from '@/catalog/application/queries';
import { CatalogRepository } from '@/catalog/infrastructure/catalog-repository';
import { CatalogController } from '@/catalog/services/catalog-controller';
import { AuthorizationPolicy, type RequestContext } from '@/core/application/authorization';
import {
  type CommandBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  type QueryBus,
} from '@/core/application/cqrs';
import { InMemoryEventBus } from '@/core/application/event-bus';
import { PgEventStore } from '@/core/infrastructure/pg-event-store';
import { PgSagaRepository } from '@/core/infrastructure/pg-saga-repository';
import { LoginPosStaffHandler } from '@/identity/application/pos-login-command';
import { GetCurrentActorHandler } from '@/identity/application/queries';
import {
  AssignStaffRoleHandler,
  CreateStaffRoleHandler,
  DeleteStaffRoleHandler,
  UpdateStaffRoleHandler,
} from '@/identity/application/role-commands';
import {
  GetAssignablePermissionsHandler,
  GetRestaurantStaffRolesHandler,
} from '@/identity/application/role-queries';
import { RolePermissionCache } from '@/identity/infrastructure/role-permission-cache';
import { IdentityController } from '@/identity/services/identity-controller';
import {
  RecordOrderSettlementHandler,
  RedeemLoyaltyPointsHandler,
} from '@/ledger/application/commands';
import { LoyaltyPointsEventHandler } from '@/ledger/application/loyalty-event-handler';
import {
  GetRestaurantLedgerHandler,
  GetUserLoyaltyBalanceHandler,
} from '@/ledger/application/queries';
import { LedgerRepository } from '@/ledger/infrastructure/ledger-repository';
import { LedgerController } from '@/ledger/services/ledger-controller';
import { AppLogger } from '@/logger';
import { PlacePosOrderHandler, SettlePosOrderHandler } from '@/ordering/application/commands';
import { OrderSettlementSaga } from '@/ordering/application/order-saga';
import { GetRestaurantOrdersHandler } from '@/ordering/application/queries';
import { OrderRepository } from '@/ordering/infrastructure/order-repository';
import { OrderController } from '@/ordering/services/order-controller';

export type { RequestContext };

export const DI_TOKENS = {
  CORE: {
    DB: 'db',
    REDIS: 'redis',
    EVENT_BUS: 'eventBus',
    EVENT_STORE: 'eventStore',
    SAGA_REPO: 'sagaRepo',
    AUTHZ: 'authz',
    COMMAND_BUS: 'commandBus',
    QUERY_BUS: 'queryBus',
  },
  IDENTITY: {
    ROLE_PERMISSION_CACHE: 'rolePermissionCache',
    LOGIN_POS_STAFF_HANDLER: 'loginPosStaffHandler',
    GET_ASSIGNABLE_PERMISSIONS_HANDLER: 'getAssignablePermissionsHandler',
    GET_CURRENT_ACTOR_HANDLER: 'getCurrentActorHandler',
    GET_RESTAURANT_STAFF_ROLES_HANDLER: 'getRestaurantStaffRolesHandler',
    CREATE_STAFF_ROLE_HANDLER: 'createStaffRoleHandler',
    UPDATE_STAFF_ROLE_HANDLER: 'updateStaffRoleHandler',
    DELETE_STAFF_ROLE_HANDLER: 'deleteStaffRoleHandler',
    ASSIGN_STAFF_ROLE_HANDLER: 'assignStaffRoleHandler',
    CONTROLLER: 'identityController',
  },
  CATALOG: {
    REPO: 'catalogRepo',
    GET_RESTAURANTS_HANDLER: 'getRestaurantsHandler',
    GET_RESTAURANT_BY_SUBDOMAIN_HANDLER: 'getRestaurantBySubdomainHandler',
    GET_MENU_SNAPSHOT_HANDLER: 'getMenuSnapshotHandler',
    MENU_CACHE_HANDLER: 'menuCacheHandler',
    CREATE_RESTAURANT_BY_ADMIN_HANDLER: 'createRestaurantByAdminHandler',
    UPDATE_RESTAURANT_STATUS_BY_ADMIN_HANDLER: 'updateRestaurantStatusByAdminHandler',
    UPDATE_ITEM_PRICE_HANDLER: 'updateItemPriceHandler',
    CONTROLLER: 'catalogController',
  },
  ORDERING: {
    REPO: 'orderRepo',
    ORDER_SAGA: 'orderSaga',
    PLACE_ORDER_HANDLER: 'placeOrderHandler',
    SETTLE_ORDER_HANDLER: 'settleOrderHandler',
    GET_ORDERS_HANDLER: 'getOrdersHandler',
    CONTROLLER: 'orderController',
  },
  LEDGER: {
    REPO: 'ledgerRepo',
    LOYALTY_EVENT_HANDLER: 'loyaltyEventHandler',
    GET_RESTAURANT_LEDGER_HANDLER: 'getRestaurantLedgerHandler',
    GET_USER_LOYALTY_HANDLER: 'getUserLoyaltyHandler',
    RECORD_SETTLEMENT_HANDLER: 'recordSettlementHandler',
    REDEEM_LOYALTY_HANDLER: 'redeemLoyaltyHandler',
    CONTROLLER: 'ledgerController',
  },
} as const;

const eventBus = new InMemoryEventBus();

function createCoreModule() {
  return new Container()
    .declareScopeInputs<{
      request: RequestContext;
      log: AppLogger;
    }>()
    .registerValue(DI_TOKENS.CORE.DB, pgPool)
    .registerValue(DI_TOKENS.CORE.REDIS, redisClient)
    .registerValue(DI_TOKENS.CORE.EVENT_BUS, eventBus)
    .registerClass(
      DI_TOKENS.CORE.EVENT_STORE,
      PgEventStore,
      [
        DI_TOKENS.CORE.DB,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.CORE.SAGA_REPO,
      PgSagaRepository,
      [
        DI_TOKENS.CORE.DB,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.CORE.AUTHZ,
      AuthorizationPolicy,
      [
        'request',
      ],
      'scoped',
    );
}

type CoreContainer = ReturnType<typeof createCoreModule>;

function registerIdentityModule<TBase extends CoreContainer>(container: TBase) {
  return container
    .registerClass(
      DI_TOKENS.IDENTITY.ROLE_PERMISSION_CACHE,
      RolePermissionCache,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.REDIS,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.IDENTITY.LOGIN_POS_STAFF_HANDLER,
      LoginPosStaffHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.IDENTITY.ROLE_PERMISSION_CACHE,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.IDENTITY.GET_ASSIGNABLE_PERMISSIONS_HANDLER,
      GetAssignablePermissionsHandler,
      [],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.IDENTITY.GET_CURRENT_ACTOR_HANDLER,
      GetCurrentActorHandler,
      [
        DI_TOKENS.CORE.DB,
        'request',
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.IDENTITY.GET_RESTAURANT_STAFF_ROLES_HANDLER,
      GetRestaurantStaffRolesHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.AUTHZ,
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.IDENTITY.CREATE_STAFF_ROLE_HANDLER,
      CreateStaffRoleHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.AUTHZ,
        'request',
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.IDENTITY.UPDATE_STAFF_ROLE_HANDLER,
      UpdateStaffRoleHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.IDENTITY.ROLE_PERMISSION_CACHE,
        DI_TOKENS.CORE.AUTHZ,
        'request',
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.IDENTITY.DELETE_STAFF_ROLE_HANDLER,
      DeleteStaffRoleHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.IDENTITY.ROLE_PERMISSION_CACHE,
        DI_TOKENS.CORE.AUTHZ,
        'request',
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.IDENTITY.ASSIGN_STAFF_ROLE_HANDLER,
      AssignStaffRoleHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.AUTHZ,
        'request',
      ],
      'scoped',
    );
}

function registerCatalogModule<TBase extends CoreContainer>(container: TBase) {
  return container
    .registerClass(
      DI_TOKENS.CATALOG.REPO,
      CatalogRepository,
      [
        DI_TOKENS.CORE.DB,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.CATALOG.GET_RESTAURANTS_HANDLER,
      GetRestaurantsHandler,
      [
        DI_TOKENS.CORE.DB,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.CATALOG.GET_RESTAURANT_BY_SUBDOMAIN_HANDLER,
      GetRestaurantBySubdomainHandler,
      [
        DI_TOKENS.CORE.DB,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.CATALOG.GET_MENU_SNAPSHOT_HANDLER,
      GetRestaurantMenuSnapshotHandler,
      [
        DI_TOKENS.CATALOG.REPO,
        DI_TOKENS.CORE.REDIS,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.CATALOG.MENU_CACHE_HANDLER,
      MenuCacheInvalidationHandler,
      [
        DI_TOKENS.CATALOG.REPO,
        DI_TOKENS.CORE.REDIS,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.CATALOG.CREATE_RESTAURANT_BY_ADMIN_HANDLER,
      CreateRestaurantByAdminHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.AUTHZ,
        'request',
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.CATALOG.UPDATE_RESTAURANT_STATUS_BY_ADMIN_HANDLER,
      UpdateRestaurantStatusByAdminHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.AUTHZ,
        'request',
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.CATALOG.UPDATE_ITEM_PRICE_HANDLER,
      UpdateMenuItemPriceHandler,
      [
        DI_TOKENS.CATALOG.REPO,
        DI_TOKENS.CORE.EVENT_BUS,
        DI_TOKENS.CORE.AUTHZ,
        'request',
      ],
      'scoped',
    );
}

function registerOrderingModule<TBase extends CoreContainer>(container: TBase) {
  return container
    .registerClass(
      DI_TOKENS.ORDERING.REPO,
      OrderRepository,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.EVENT_STORE,
        DI_TOKENS.CORE.EVENT_BUS,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.ORDERING.PLACE_ORDER_HANDLER,
      PlacePosOrderHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.ORDERING.REPO,
        DI_TOKENS.CORE.AUTHZ,
        'request',
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.ORDERING.SETTLE_ORDER_HANDLER,
      SettlePosOrderHandler,
      [
        DI_TOKENS.ORDERING.REPO,
        DI_TOKENS.CORE.AUTHZ,
        'request',
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.ORDERING.GET_ORDERS_HANDLER,
      GetRestaurantOrdersHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.AUTHZ,
      ],
      'scoped',
    );
}

function registerLedgerModule<TBase extends CoreContainer>(container: TBase) {
  return container
    .registerClass(
      DI_TOKENS.LEDGER.REPO,
      LedgerRepository,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.EVENT_STORE,
        DI_TOKENS.CORE.EVENT_BUS,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.LEDGER.LOYALTY_EVENT_HANDLER,
      LoyaltyPointsEventHandler,
      [
        DI_TOKENS.LEDGER.REPO,
      ],
      'singleton',
    )
    .registerClass(
      DI_TOKENS.LEDGER.GET_RESTAURANT_LEDGER_HANDLER,
      GetRestaurantLedgerHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.AUTHZ,
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.LEDGER.GET_USER_LOYALTY_HANDLER,
      GetUserLoyaltyBalanceHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.CORE.AUTHZ,
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.LEDGER.RECORD_SETTLEMENT_HANDLER,
      RecordOrderSettlementHandler,
      [
        DI_TOKENS.LEDGER.REPO,
        'request',
      ],
      'scoped',
    )
    .registerClass(
      DI_TOKENS.LEDGER.REDEEM_LOYALTY_HANDLER,
      RedeemLoyaltyPointsHandler,
      [
        DI_TOKENS.CORE.DB,
        DI_TOKENS.LEDGER.REPO,
        DI_TOKENS.CORE.AUTHZ,
        'request',
      ],
      'scoped',
    );
}

const domainContainer = registerLedgerModule(
  registerOrderingModule(registerCatalogModule(registerIdentityModule(createCoreModule()))),
).registerClass(
  DI_TOKENS.ORDERING.ORDER_SAGA,
  OrderSettlementSaga,
  [
    DI_TOKENS.LEDGER.REPO,
    DI_TOKENS.CORE.SAGA_REPO,
  ],
  'singleton',
);

type DomainScope = ReturnType<typeof domainContainer.createScope>;

function registerIdentityCommands(c: DomainScope, commandBus: CommandBus): void {
  commandBus.register('LoginPosStaff', c.get(DI_TOKENS.IDENTITY.LOGIN_POS_STAFF_HANDLER));
  commandBus.register('CreateStaffRole', c.get(DI_TOKENS.IDENTITY.CREATE_STAFF_ROLE_HANDLER), {
    requiredPermission: 'staff:roles:manage',
  });
  commandBus.register('UpdateStaffRole', c.get(DI_TOKENS.IDENTITY.UPDATE_STAFF_ROLE_HANDLER), {
    requiredPermission: 'staff:roles:manage',
  });
  commandBus.register('DeleteStaffRole', c.get(DI_TOKENS.IDENTITY.DELETE_STAFF_ROLE_HANDLER), {
    requiredPermission: 'staff:roles:manage',
  });
  commandBus.register('AssignStaffRole', c.get(DI_TOKENS.IDENTITY.ASSIGN_STAFF_ROLE_HANDLER), {
    requiredPermission: 'staff:manage',
  });
}

function registerIdentityQueries(c: DomainScope, queryBus: QueryBus): void {
  queryBus.register('GetCurrentActor', c.get(DI_TOKENS.IDENTITY.GET_CURRENT_ACTOR_HANDLER));
  queryBus.register(
    'GetAssignablePermissions',
    c.get(DI_TOKENS.IDENTITY.GET_ASSIGNABLE_PERMISSIONS_HANDLER),
    {
      requiredPermission: 'staff:roles:manage',
    },
  );
  queryBus.register(
    'GetRestaurantStaffRoles',
    c.get(DI_TOKENS.IDENTITY.GET_RESTAURANT_STAFF_ROLES_HANDLER),
    {
      requiredPermission: 'staff:roles:manage',
    },
  );
}

function registerCatalogCommands(c: DomainScope, commandBus: CommandBus): void {
  commandBus.register(
    'CreateRestaurantByAdmin',
    c.get(DI_TOKENS.CATALOG.CREATE_RESTAURANT_BY_ADMIN_HANDLER),
    {
      requiredPermission: 'platform:restaurants:manage',
    },
  );
  commandBus.register(
    'UpdateRestaurantStatusByAdmin',
    c.get(DI_TOKENS.CATALOG.UPDATE_RESTAURANT_STATUS_BY_ADMIN_HANDLER),
    {
      requiredPermission: 'platform:restaurants:manage',
    },
  );
  commandBus.register('UpdateMenuItemPrice', c.get(DI_TOKENS.CATALOG.UPDATE_ITEM_PRICE_HANDLER), {
    requiredPermission: 'catalog:price:update',
  });
}

function registerCatalogQueries(c: DomainScope, queryBus: QueryBus): void {
  queryBus.register('GetRestaurants', c.get(DI_TOKENS.CATALOG.GET_RESTAURANTS_HANDLER));
  queryBus.register(
    'GetRestaurantBySubdomain',
    c.get(DI_TOKENS.CATALOG.GET_RESTAURANT_BY_SUBDOMAIN_HANDLER),
  );
  queryBus.register(
    'GetRestaurantMenuSnapshot',
    c.get(DI_TOKENS.CATALOG.GET_MENU_SNAPSHOT_HANDLER),
  );
}

function registerOrderingCommands(c: DomainScope, commandBus: CommandBus): void {
  commandBus.register('PlacePosOrder', c.get(DI_TOKENS.ORDERING.PLACE_ORDER_HANDLER), {
    requiredPermission: 'orders:place',
  });
  commandBus.register('SettlePosOrder', c.get(DI_TOKENS.ORDERING.SETTLE_ORDER_HANDLER), {
    requiredPermission: 'orders:settle',
  });
}

function registerOrderingQueries(c: DomainScope, queryBus: QueryBus): void {
  queryBus.register('GetRestaurantOrders', c.get(DI_TOKENS.ORDERING.GET_ORDERS_HANDLER), {
    requiredPermission: 'orders:read',
  });
}

function registerLedgerCommands(c: DomainScope, commandBus: CommandBus): void {
  commandBus.register('RecordOrderSettlement', c.get(DI_TOKENS.LEDGER.RECORD_SETTLEMENT_HANDLER));
  commandBus.register('RedeemLoyaltyPoints', c.get(DI_TOKENS.LEDGER.REDEEM_LOYALTY_HANDLER), {
    requiredPermission: 'loyalty:redeem',
  });
}

function registerLedgerQueries(c: DomainScope, queryBus: QueryBus): void {
  queryBus.register('GetRestaurantLedger', c.get(DI_TOKENS.LEDGER.GET_RESTAURANT_LEDGER_HANDLER), {
    requiredPermission: 'ledger:read',
  });
  queryBus.register('GetUserLoyaltyBalance', c.get(DI_TOKENS.LEDGER.GET_USER_LOYALTY_HANDLER), {
    requiredPermission: 'loyalty:read',
  });
}

export const rootContainer = domainContainer
  .registerFactory(
    DI_TOKENS.CORE.COMMAND_BUS,
    (c) => {
      const bus = new InMemoryCommandBus(c.get('log'), c.get(DI_TOKENS.CORE.AUTHZ));
      registerIdentityCommands(c, bus);
      registerCatalogCommands(c, bus);
      registerOrderingCommands(c, bus);
      registerLedgerCommands(c, bus);
      return bus;
    },
    [
      'log',
      DI_TOKENS.CORE.AUTHZ,
      DI_TOKENS.IDENTITY.LOGIN_POS_STAFF_HANDLER,
      DI_TOKENS.IDENTITY.CREATE_STAFF_ROLE_HANDLER,
      DI_TOKENS.IDENTITY.UPDATE_STAFF_ROLE_HANDLER,
      DI_TOKENS.IDENTITY.DELETE_STAFF_ROLE_HANDLER,
      DI_TOKENS.IDENTITY.ASSIGN_STAFF_ROLE_HANDLER,
      DI_TOKENS.CATALOG.CREATE_RESTAURANT_BY_ADMIN_HANDLER,
      DI_TOKENS.CATALOG.UPDATE_RESTAURANT_STATUS_BY_ADMIN_HANDLER,
      DI_TOKENS.CATALOG.UPDATE_ITEM_PRICE_HANDLER,
      DI_TOKENS.ORDERING.PLACE_ORDER_HANDLER,
      DI_TOKENS.ORDERING.SETTLE_ORDER_HANDLER,
      DI_TOKENS.LEDGER.RECORD_SETTLEMENT_HANDLER,
      DI_TOKENS.LEDGER.REDEEM_LOYALTY_HANDLER,
    ],
    'scoped',
  )
  .registerFactory(
    DI_TOKENS.CORE.QUERY_BUS,
    (c) => {
      const bus = new InMemoryQueryBus(c.get(DI_TOKENS.CORE.AUTHZ));
      registerIdentityQueries(c, bus);
      registerCatalogQueries(c, bus);
      registerOrderingQueries(c, bus);
      registerLedgerQueries(c, bus);
      return bus;
    },
    [
      DI_TOKENS.CORE.AUTHZ,
      DI_TOKENS.IDENTITY.GET_CURRENT_ACTOR_HANDLER,
      DI_TOKENS.IDENTITY.GET_ASSIGNABLE_PERMISSIONS_HANDLER,
      DI_TOKENS.IDENTITY.GET_RESTAURANT_STAFF_ROLES_HANDLER,
      DI_TOKENS.CATALOG.GET_RESTAURANTS_HANDLER,
      DI_TOKENS.CATALOG.GET_RESTAURANT_BY_SUBDOMAIN_HANDLER,
      DI_TOKENS.CATALOG.GET_MENU_SNAPSHOT_HANDLER,
      DI_TOKENS.ORDERING.GET_ORDERS_HANDLER,
      DI_TOKENS.LEDGER.GET_RESTAURANT_LEDGER_HANDLER,
      DI_TOKENS.LEDGER.GET_USER_LOYALTY_HANDLER,
    ],
    'scoped',
  )
  .registerClass(
    DI_TOKENS.IDENTITY.CONTROLLER,
    IdentityController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
      'request',
    ],
    'scoped',
  )
  .registerClass(
    DI_TOKENS.CATALOG.CONTROLLER,
    CatalogController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
    ],
    'scoped',
  )
  .registerClass(
    DI_TOKENS.ORDERING.CONTROLLER,
    OrderController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
      'request',
    ],
    'scoped',
  )
  .registerClass(
    DI_TOKENS.LEDGER.CONTROLLER,
    LedgerController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
      'request',
    ],
    'scoped',
  );

function registerDomainEventSubscribers(scope: RequestScope, bus: InMemoryEventBus): void {
  scope.get(DI_TOKENS.ORDERING.ORDER_SAGA).register(bus);
  scope.get(DI_TOKENS.CATALOG.MENU_CACHE_HANDLER).register(bus);
  scope.get(DI_TOKENS.LEDGER.LOYALTY_EVENT_HANDLER).register(bus);
}

const bootScope = rootContainer.createScope({
  request: {
    requestId: 'bootstrap',
    actorId: SYSTEM_ACTORS.SYSTEM_CRON,
    actorSource: 'SYSTEM',
    permissions: ALL_PERMISSIONS,
  },
  log: new AppLogger('bootstrap'),
});
registerDomainEventSubscribers(bootScope, eventBus);

export type RequestScope = ReturnType<typeof rootContainer.createScope>;
export type AppEnv = InferdiHonoScopeEnv<RequestScope>;
