import { ALL_PERMISSIONS, type Pool, pgPool, redisClient, SYSTEM_ACTORS } from '@foodapp/db';
import type { InferdiHonoScopeEnv } from '@inferdi/hono';
import {
  Container,
  type Module,
  type ScopeInputMap,
  type Spec,
  type WithRequirements,
} from '@inferdi/inferdi';
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
import { type EventBus, InMemoryEventBus } from '@/core/application/event-bus';
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

type RedisClientType = typeof redisClient;

export const DI_TOKENS = {
  CORE: {
    REQUEST: 'request',
    LOG: 'log',
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

// Core infrastructure container shared across all bounded contexts.
// Singletons (pgPool, redisClient, eventBus) live for the entire process, while `authz` is
// registered as 'scoped' so each HTTP request gets an isolated tenant/actor permission boundary.
// Note: `EVENT_BUS` passes explicit `<token, EventBus>` generics to widen `InMemoryEventBus`
// to the `EventBus` interface required by `CoreDeps`

type CoreDeps = ScopeInputMap<{
  request: RequestContext;
  log: AppLogger;
}> & {
  db: Spec<Pool, 'singleton'>;
  redis: Spec<RedisClientType, 'singleton'>;
  eventBus: Spec<EventBus, 'singleton'>;
  eventStore: Spec<PgEventStore, 'singleton'>;
  sagaRepo: Spec<PgSagaRepository, 'singleton'>;
  authz: WithRequirements<Spec<AuthorizationPolicy, 'scoped'>, 'request'>;
};

const eventBus = new InMemoryEventBus();

const coreContainer: Container<CoreDeps> = new Container()
  .declareScopeInputs<{
    request: RequestContext;
    log: AppLogger;
  }>()
  .registerValue(DI_TOKENS.CORE.DB, pgPool)
  .registerValue(DI_TOKENS.CORE.REDIS, redisClient)
  // Domain Event Bus (pub/sub for async DomainEvents; separate from request-scoped CQRS CommandBus & QueryBus).
  .registerValue<typeof DI_TOKENS.CORE.EVENT_BUS, EventBus>(DI_TOKENS.CORE.EVENT_BUS, eventBus)
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
      DI_TOKENS.CORE.REQUEST,
    ],
    'scoped',
  );

/**
 * ============================================================================
 * BOUNDED CONTEXT BUILDER (SINGLE SOURCE OF TRUTH IN `container.ts`)
 * ============================================================================
 * Each bounded context is defined in ONE `defineBoundedContext({ ... })` call
 * using only `DI_TOKENS` (no hardcoded token strings):
 *   1. `module`: Registers repositories, handlers, and sagas on `CoreDeps`
 *   2. `commands`: Binds command handlers onto `CommandBus`
 *   3. `queries`: Binds query handlers onto `QueryBus`
 *   4. `subscribers` (optional): Registers domain event listeners on `EventBus`
 *
 * --- HOW TO ADD A NEW CONTEXT (DUMMY EXAMPLE: "Inventory") ---
 * Step 1: Add `INVENTORY: { REPO: 'inventoryRepo', UPDATE_HANDLER: 'updateStockHandler', ... }` to `DI_TOKENS`.
 * Step 2: Define `type InventoryProvides = { ... }` and call `defineBoundedContext<InventoryProvides>({ ... })`:
 *
 * const inventoryModule = defineBoundedContext<InventoryProvides>({
 *   name: 'Inventory',
 *   commandDeps: [DI_TOKENS.INVENTORY.UPDATE_HANDLER],
 *   queryDeps: [DI_TOKENS.INVENTORY.GET_HANDLER],
 *   module: (c) =>
 *     c
 *       .registerClass(DI_TOKENS.INVENTORY.REPO, InventoryRepository, [DI_TOKENS.CORE.DB], 'singleton')
 *       .registerClass(DI_TOKENS.INVENTORY.UPDATE_HANDLER, UpdateStockHandler, [DI_TOKENS.INVENTORY.REPO, DI_TOKENS.CORE.AUTHZ, DI_TOKENS.CORE.REQUEST], 'scoped')
 *       .registerClass(DI_TOKENS.INVENTORY.GET_HANDLER, GetStockHandler, [DI_TOKENS.INVENTORY.REPO, DI_TOKENS.CORE.AUTHZ], 'scoped'),
 *   commands: (c, bus) => {
 *     bus.register('UpdateStock', c.get(DI_TOKENS.INVENTORY.UPDATE_HANDLER), { requiredPermission: 'catalog:price:update' });
 *   },
 *   queries: (c, bus) => {
 *     bus.register('GetStock', c.get(DI_TOKENS.INVENTORY.GET_HANDLER));
 *   },
 *   subscribers: (scope, bus) => {
 *     scope.get(DI_TOKENS.INVENTORY.STOCK_EVENT_HANDLER).register(bus);
 *   },
 * });
 *
 * Step 3: Add `inventoryModule` to `BOUNDED_CONTEXTS`, chain `.use(inventoryModule.module)`
 *         on `domainContainer`, register its controller on `rootContainer`, and add its
 *         public services to `ScopeServices`.
 * ============================================================================
 */

interface ContextResolver<TKeys extends string> {
  get<K extends TKeys>(key: K): K extends keyof DomainResolved ? DomainResolved[K] : never;
}

interface BoundedContextBuilder<
  TProvides extends Record<string, Spec<unknown, 'singleton' | 'scoped'>>,
> {
  readonly name: string;
  readonly commandDeps: readonly Extract<keyof TProvides, string>[];
  readonly queryDeps: readonly Extract<keyof TProvides, string>[];
  readonly module: Module<CoreDeps, TProvides>;
  readonly commands: (
    c: ContextResolver<Extract<keyof TProvides, string>>,
    commandBus: CommandBus,
  ) => void;
  readonly queries: (
    c: ContextResolver<Extract<keyof TProvides, string>>,
    queryBus: QueryBus,
  ) => void;
  readonly subscribers?: (scope: RequestScope, bus: InMemoryEventBus) => void;
}

function defineBoundedContext<
  TProvides extends Record<string, Spec<unknown, 'singleton' | 'scoped'>>,
>(definition: BoundedContextBuilder<TProvides>): BoundedContextBuilder<TProvides> {
  return definition;
}

// ============================================================================
// DECLARED BOUNDED CONTEXTS
// Each context below encapsulates its own DI services, CQRS command/query
// handlers, and async domain event subscribers in one self-contained block.
// ============================================================================

// Declaring Identity bounded context:
// Handles POS staff shift authentication, global Better Auth actor resolution, and
// dynamic tenant PBAC role/permission management. Handlers that read `DI_TOKENS.CORE.REQUEST`
// are 'scoped' per request; `RolePermissionCache` is a 'singleton' backed by Redis.

type IdentityProvides = {
  rolePermissionCache: Spec<RolePermissionCache, 'singleton'>;
  loginPosStaffHandler: Spec<LoginPosStaffHandler, 'singleton'>;
  getAssignablePermissionsHandler: Spec<GetAssignablePermissionsHandler, 'singleton'>;
  getCurrentActorHandler: WithRequirements<Spec<GetCurrentActorHandler, 'scoped'>, 'request'>;
  getRestaurantStaffRolesHandler: WithRequirements<
    Spec<GetRestaurantStaffRolesHandler, 'scoped'>,
    'request'
  >;
  createStaffRoleHandler: WithRequirements<Spec<CreateStaffRoleHandler, 'scoped'>, 'request'>;
  updateStaffRoleHandler: WithRequirements<Spec<UpdateStaffRoleHandler, 'scoped'>, 'request'>;
  deleteStaffRoleHandler: WithRequirements<Spec<DeleteStaffRoleHandler, 'scoped'>, 'request'>;
  assignStaffRoleHandler: WithRequirements<Spec<AssignStaffRoleHandler, 'scoped'>, 'request'>;
};

const identityModule = defineBoundedContext<IdentityProvides>({
  name: 'Identity',
  commandDeps: [
    DI_TOKENS.IDENTITY.LOGIN_POS_STAFF_HANDLER,
    DI_TOKENS.IDENTITY.CREATE_STAFF_ROLE_HANDLER,
    DI_TOKENS.IDENTITY.UPDATE_STAFF_ROLE_HANDLER,
    DI_TOKENS.IDENTITY.DELETE_STAFF_ROLE_HANDLER,
    DI_TOKENS.IDENTITY.ASSIGN_STAFF_ROLE_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.IDENTITY.GET_CURRENT_ACTOR_HANDLER,
    DI_TOKENS.IDENTITY.GET_ASSIGNABLE_PERMISSIONS_HANDLER,
    DI_TOKENS.IDENTITY.GET_RESTAURANT_STAFF_ROLES_HANDLER,
  ],
  module: (container) =>
    container
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
          DI_TOKENS.CORE.REQUEST,
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
          DI_TOKENS.CORE.REQUEST,
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
          DI_TOKENS.CORE.REQUEST,
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
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.IDENTITY.ASSIGN_STAFF_ROLE_HANDLER,
        AssignStaffRoleHandler,
        [
          DI_TOKENS.CORE.DB,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      ),
  commands: (c, commandBus) => {
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
  },
  queries: (c, queryBus) => {
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
  },
});

// Declaring Catalog bounded context:
// Manages public storefront restaurant discovery, admin tenant provisioning, and
// pre-compiled JSONB + Redis menu snapshots. Subscribes to `RestaurantMenuUpdated`
// events to rebuild and invalidate stale menu caches asynchronously.

type CatalogProvides = {
  catalogRepo: Spec<CatalogRepository, 'singleton'>;
  getRestaurantsHandler: Spec<GetRestaurantsHandler, 'singleton'>;
  getRestaurantBySubdomainHandler: Spec<GetRestaurantBySubdomainHandler, 'singleton'>;
  getMenuSnapshotHandler: Spec<GetRestaurantMenuSnapshotHandler, 'singleton'>;
  menuCacheHandler: Spec<MenuCacheInvalidationHandler, 'singleton'>;
  createRestaurantByAdminHandler: WithRequirements<
    Spec<CreateRestaurantByAdminHandler, 'scoped'>,
    'request'
  >;
  updateRestaurantStatusByAdminHandler: WithRequirements<
    Spec<UpdateRestaurantStatusByAdminHandler, 'scoped'>,
    'request'
  >;
  updateItemPriceHandler: WithRequirements<Spec<UpdateMenuItemPriceHandler, 'scoped'>, 'request'>;
};

const catalogModule = defineBoundedContext<CatalogProvides>({
  name: 'Catalog',
  commandDeps: [
    DI_TOKENS.CATALOG.CREATE_RESTAURANT_BY_ADMIN_HANDLER,
    DI_TOKENS.CATALOG.UPDATE_RESTAURANT_STATUS_BY_ADMIN_HANDLER,
    DI_TOKENS.CATALOG.UPDATE_ITEM_PRICE_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.CATALOG.GET_RESTAURANTS_HANDLER,
    DI_TOKENS.CATALOG.GET_RESTAURANT_BY_SUBDOMAIN_HANDLER,
    DI_TOKENS.CATALOG.GET_MENU_SNAPSHOT_HANDLER,
  ],
  module: (container) =>
    container
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
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.CATALOG.UPDATE_RESTAURANT_STATUS_BY_ADMIN_HANDLER,
        UpdateRestaurantStatusByAdminHandler,
        [
          DI_TOKENS.CORE.DB,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
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
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      ),
  commands: (c, commandBus) => {
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
  },
  queries: (c, queryBus) => {
    queryBus.register('GetRestaurants', c.get(DI_TOKENS.CATALOG.GET_RESTAURANTS_HANDLER));
    queryBus.register(
      'GetRestaurantBySubdomain',
      c.get(DI_TOKENS.CATALOG.GET_RESTAURANT_BY_SUBDOMAIN_HANDLER),
    );
    queryBus.register(
      'GetRestaurantMenuSnapshot',
      c.get(DI_TOKENS.CATALOG.GET_MENU_SNAPSHOT_HANDLER),
    );
  },
  subscribers: (scope, bus) => {
    scope.get(DI_TOKENS.CATALOG.MENU_CACHE_HANDLER).register(bus);
  },
});

// Declaring Ordering bounded context:
// Owns event-sourced POS order placement, KDS ticket routing, and bill settlement.
// Subscribes `OrderSettlementSaga` to `PosOrderSettled` events so financial ledger
// entries are recorded idempotently with saga compensation tracking.

type OrderingProvides = {
  orderRepo: Spec<OrderRepository, 'singleton'>;
  placeOrderHandler: WithRequirements<Spec<PlacePosOrderHandler, 'scoped'>, 'request'>;
  settleOrderHandler: WithRequirements<Spec<SettlePosOrderHandler, 'scoped'>, 'request'>;
  getOrdersHandler: WithRequirements<Spec<GetRestaurantOrdersHandler, 'scoped'>, 'request'>;
};

const orderingModule = defineBoundedContext<OrderingProvides>({
  name: 'Ordering',
  commandDeps: [
    DI_TOKENS.ORDERING.PLACE_ORDER_HANDLER,
    DI_TOKENS.ORDERING.SETTLE_ORDER_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.ORDERING.GET_ORDERS_HANDLER,
  ],
  module: (container) =>
    container
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
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.ORDERING.SETTLE_ORDER_HANDLER,
        SettlePosOrderHandler,
        [
          DI_TOKENS.ORDERING.REPO,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
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
      ),
  commands: (c, commandBus) => {
    commandBus.register('PlacePosOrder', c.get(DI_TOKENS.ORDERING.PLACE_ORDER_HANDLER), {
      requiredPermission: 'orders:place',
    });
    commandBus.register('SettlePosOrder', c.get(DI_TOKENS.ORDERING.SETTLE_ORDER_HANDLER), {
      requiredPermission: 'orders:settle',
    });
  },
  queries: (c, queryBus) => {
    queryBus.register('GetRestaurantOrders', c.get(DI_TOKENS.ORDERING.GET_ORDERS_HANDLER), {
      requiredPermission: 'orders:read',
    });
  },
  subscribers: (scope, bus) => {
    scope.get(DI_TOKENS.ORDERING.ORDER_SAGA).register(bus);
  },
});

// Declaring Ledger bounded context:
// Enforces double-entry UK VAT/commission accounting (`GATEWAY_CLEARING`, merchant net,
// platform fee, HMRC VAT) and customer loyalty point accrual/redemption. Subscribes to
// `LoyaltyPointsEligible` events emitted after order settlement.

type LedgerProvides = {
  ledgerRepo: Spec<LedgerRepository, 'singleton'>;
  loyaltyEventHandler: Spec<LoyaltyPointsEventHandler, 'singleton'>;
  getRestaurantLedgerHandler: WithRequirements<
    Spec<GetRestaurantLedgerHandler, 'scoped'>,
    'request'
  >;
  getUserLoyaltyHandler: WithRequirements<Spec<GetUserLoyaltyBalanceHandler, 'scoped'>, 'request'>;
  recordSettlementHandler: WithRequirements<
    Spec<RecordOrderSettlementHandler, 'scoped'>,
    'request'
  >;
  redeemLoyaltyHandler: WithRequirements<Spec<RedeemLoyaltyPointsHandler, 'scoped'>, 'request'>;
};

const ledgerModule = defineBoundedContext<LedgerProvides>({
  name: 'Ledger',
  commandDeps: [
    DI_TOKENS.LEDGER.RECORD_SETTLEMENT_HANDLER,
    DI_TOKENS.LEDGER.REDEEM_LOYALTY_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.LEDGER.GET_RESTAURANT_LEDGER_HANDLER,
    DI_TOKENS.LEDGER.GET_USER_LOYALTY_HANDLER,
  ],
  module: (container) =>
    container
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
          DI_TOKENS.CORE.REQUEST,
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
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      ),
  commands: (c, commandBus) => {
    commandBus.register('RecordOrderSettlement', c.get(DI_TOKENS.LEDGER.RECORD_SETTLEMENT_HANDLER));
    commandBus.register('RedeemLoyaltyPoints', c.get(DI_TOKENS.LEDGER.REDEEM_LOYALTY_HANDLER), {
      requiredPermission: 'loyalty:redeem',
    });
  },
  queries: (c, queryBus) => {
    queryBus.register(
      'GetRestaurantLedger',
      c.get(DI_TOKENS.LEDGER.GET_RESTAURANT_LEDGER_HANDLER),
      {
        requiredPermission: 'ledger:read',
      },
    );
    queryBus.register('GetUserLoyaltyBalance', c.get(DI_TOKENS.LEDGER.GET_USER_LOYALTY_HANDLER), {
      requiredPermission: 'loyalty:read',
    });
  },
  subscribers: (scope, bus) => {
    scope.get(DI_TOKENS.LEDGER.LOYALTY_EVENT_HANDLER).register(bus);
  },
});

// ============================================================================
// REGISTERING BOUNDED CONTEXTS & COMPOSING ROOT CONTAINER
// 1. `BOUNDED_CONTEXTS` drives automatic CQRS bus and event subscriber wiring.
// 2. `domainContainer` merges all context modules plus cross-context sagas.
// 3. `rootContainer` registers request-scoped CQRS buses and HTTP controllers.
// ============================================================================

const BOUNDED_CONTEXTS = [
  identityModule,
  catalogModule,
  orderingModule,
  ledgerModule,
] as const;

// Composes all bounded context modules onto `coreContainer`.
// Edge case: `OrderSettlementSaga` is registered here (after `ledgerModule`) because
// it depends on both `DI_TOKENS.LEDGER.REPO` and `DI_TOKENS.CORE.SAGA_REPO`.
const domainContainer = coreContainer
  .use(identityModule.module)
  .use(catalogModule.module)
  .use(orderingModule.module)
  .use(ledgerModule.module)
  .registerClass(
    DI_TOKENS.ORDERING.ORDER_SAGA,
    OrderSettlementSaga,
    [
      DI_TOKENS.LEDGER.REPO,
      DI_TOKENS.CORE.SAGA_REPO,
    ],
    'singleton',
  );

type DomainResolved = Container.Resolve<typeof domainContainer>;

export const rootContainer = domainContainer
  // Registers request-scoped CommandBus after all context command handlers are bound.
  .registerFactory(
    DI_TOKENS.CORE.COMMAND_BUS,
    (c): CommandBus => {
      const bus = new InMemoryCommandBus(c.get(DI_TOKENS.CORE.LOG), c.get(DI_TOKENS.CORE.AUTHZ));
      for (const ctx of BOUNDED_CONTEXTS) {
        ctx.commands(c as unknown as ContextResolver<string>, bus);
      }
      return bus;
    },
    [
      DI_TOKENS.CORE.LOG,
      DI_TOKENS.CORE.AUTHZ,
      ...BOUNDED_CONTEXTS.flatMap((ctx) => ctx.commandDeps),
    ],
    'scoped',
  )
  // Registers request-scoped QueryBus after all context query handlers are bound.
  .registerFactory(
    DI_TOKENS.CORE.QUERY_BUS,
    (c): QueryBus => {
      const bus = new InMemoryQueryBus(c.get(DI_TOKENS.CORE.AUTHZ));
      for (const ctx of BOUNDED_CONTEXTS) {
        ctx.queries(c as unknown as ContextResolver<string>, bus);
      }
      return bus;
    },
    [
      DI_TOKENS.CORE.AUTHZ,
      ...BOUNDED_CONTEXTS.flatMap((ctx) => ctx.queryDeps),
    ],
    'scoped',
  )
  // HTTP controllers are 'scoped' per request so they receive request-bound buses and context.
  // Edge case: `CatalogController` omits `DI_TOKENS.CORE.REQUEST` because storefront menu
  // reads are public and tenant-specific mutations extract `restaurantId` via handlers.
  .registerClass(
    DI_TOKENS.IDENTITY.CONTROLLER,
    IdentityController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
      DI_TOKENS.CORE.REQUEST,
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
      DI_TOKENS.CORE.REQUEST,
    ],
    'scoped',
  )
  .registerClass(
    DI_TOKENS.LEDGER.CONTROLLER,
    LedgerController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
      DI_TOKENS.CORE.REQUEST,
    ],
    'scoped',
  );

export interface ScopeServices {
  request: RequestContext;
  log: AppLogger;
  db: Pool;
  redis: RedisClientType;
  eventBus: EventBus;
  eventStore: PgEventStore;
  sagaRepo: PgSagaRepository;
  authz: AuthorizationPolicy;
  commandBus: CommandBus;
  queryBus: QueryBus;
  rolePermissionCache: RolePermissionCache;
  identityController: IdentityController;
  catalogRepo: CatalogRepository;
  menuCacheHandler: MenuCacheInvalidationHandler;
  catalogController: CatalogController;
  orderRepo: OrderRepository;
  orderController: OrderController;
  orderSaga: OrderSettlementSaga;
  ledgerRepo: LedgerRepository;
  loyaltyEventHandler: LoyaltyPointsEventHandler;
  ledgerController: LedgerController;
}

export interface RequestScope {
  get<K extends keyof ScopeServices>(key: K): ScopeServices[K];
  dispose(): Promise<void>;
}

// Subscribes all singleton domain event listeners to the process-wide `InMemoryEventBus`.
// Edge case: Uses a dedicated `bootScope` with `SYSTEM_CRON` privileges at module load time
// so event handlers are registered exactly once rather than duplicated on every HTTP request.
function registerDomainEventSubscribers(scope: RequestScope, bus: InMemoryEventBus): void {
  for (const ctx of BOUNDED_CONTEXTS) {
    ctx.subscribers?.(scope, bus);
  }
}

const bootScope: RequestScope = rootContainer.createScope({
  request: {
    requestId: 'bootstrap',
    actorId: SYSTEM_ACTORS.SYSTEM_CRON,
    actorSource: 'SYSTEM',
    permissions: ALL_PERMISSIONS,
  },
  log: new AppLogger('bootstrap'),
});

registerDomainEventSubscribers(bootScope, eventBus);

export type AppEnv = InferdiHonoScopeEnv<RequestScope>;
