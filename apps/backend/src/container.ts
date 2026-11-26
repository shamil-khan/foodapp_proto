import {
  BOOTSTRAP_ACTOR_ID,
  type DbReader,
  dbReader,
  redisClient,
  type UnitOfWork,
  unitOfWork,
} from '@foodapp/db';
import type { InferdiHonoScopeEnv } from '@inferdi/hono';
import {
  Container,
  type Module,
  type ScopeInputMap,
  type Spec,
  type WithRequirements,
} from '@inferdi/inferdi';
import { BillingSettlementEventHandler } from '@/billing/application/billing-event-handler';
import {
  BillingSettlementService,
  RefundOrderHandler,
  SettleMerchantHandler,
} from '@/billing/application/commands';
import { GetRestaurantBillingHandler } from '@/billing/application/queries';
import { BillingRepository } from '@/billing/infrastructure/billing-repository';
import { DeterministicMockGateway } from '@/billing/infrastructure/mocks/deterministic-mock-gateway';
import { MockCardTerminalAdapter } from '@/billing/infrastructure/mocks/mock-card-terminal';
import { BillingController } from '@/billing/services/billing-controller';
import {
  CreateRestaurantByAdminHandler,
  UpdateRestaurantStatusByAdminHandler,
} from '@/brand/application/admin-brand-commands';
import {
  CreateBrandBranchHandler,
  RegisterBrandHandler,
  ReviewTakeawayWhitelistHandler,
  UpdateBranchOperationalStatusHandler,
  UpdateBranchSettingsHandler,
} from '@/brand/application/brand-commands';
import { BrandOnboardingSaga } from '@/brand/application/brand-onboarding-saga';
import {
  ListBrandsHandler,
  ResolveBranchBySlugHandler,
  ResolveBrandByHandleHandler,
} from '@/brand/application/queries';
import { BranchStatusCache } from '@/brand/infrastructure/branch-status-cache';
import { BrandController } from '@/brand/services/brand-controller';
import { BrandCatalogOnboardingHandler } from '@/catalog/application/brand-catalog-onboarding-handlers';
import { BranchCatalogSyncSaga } from '@/catalog/application/brand-catalog-sync-saga';
import { UpdateMenuItemPriceHandler } from '@/catalog/application/commands';
import {
  CreateMenuItemHandler,
  ReviewPriceOverrideHandler,
  UpsertBranchMenuOverrideHandler,
  UpsertPricingPolicyHandler,
} from '@/catalog/application/pricing-policy-commands';
import { GetBranchMenuSnapshotHandler } from '@/catalog/application/queries';
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
import type { ScopedFactory } from '@/core/application/scoped-factory';
import { PgEventStore } from '@/core/infrastructure/pg-event-store';
import { PgSagaRepository } from '@/core/infrastructure/pg-saga-repository';
import { ReadRepository } from '@/core/infrastructure/read-repository';
import { RedisIdempotencyStore } from '@/core/services/idempotency-middleware';
import { SwitchPosBranchHandler } from '@/iam/application/branch-switch-command';
import { BrandIamOnboardingHandler } from '@/iam/application/brand-onboarding-handlers';
import { LoginPosStaffHandler } from '@/iam/application/pos-login-command';
import { GetCurrentActorHandler } from '@/iam/application/queries';
import {
  AssignStaffBranchAccessHandler,
  CreateStaffRoleHandler,
  DeleteStaffRoleHandler,
  UpdateStaffRoleHandler,
} from '@/iam/application/role-commands';
import {
  GetAssignablePermissionsHandler,
  GetRestaurantStaffRolesHandler,
} from '@/iam/application/role-queries';
import type { SupportAccessPort } from '@/iam/application/support-access-port';
import { RolePermissionCache } from '@/iam/infrastructure/role-permission-cache';
import { IamController } from '@/iam/services/iam-controller';
import { AppLogger } from '@/logger';
import {
  AuditLoyaltyEntryHandler,
  LoyaltySettlementService,
  UpdateLoyaltyGovernanceHandler,
} from '@/loyalty/application/commands';
import { LoyaltySettlementEventHandler } from '@/loyalty/application/loyalty-event-handler';
import { SystemClock } from '@/loyalty/application/loyalty-ports';
import { GetCustomerLoyaltyHandler } from '@/loyalty/application/queries';
import { LoyaltyRepository } from '@/loyalty/infrastructure/loyalty-repository';
import { LoyaltyController } from '@/loyalty/services/loyalty-controller';
import { RedisCartService } from '@/orders/application/cart-service';
import {
  CheckoutOrderHandler,
  PlacePosOrderHandler,
  PreviewOrderHandler,
  SettlePosOrderHandler,
  TransitionOrderStatusHandler,
} from '@/orders/application/commands';
import { OrderCheckoutSaga } from '@/orders/application/order-checkout-saga';
import { OrderSettlementSaga } from '@/orders/application/order-saga';
import { SyncPosOrdersHandler } from '@/orders/application/pos-sync-command';
import {
  GetOrderByIdHandler,
  GetOrderEventsSinceHandler,
  GetRestaurantOrdersHandler,
} from '@/orders/application/queries';
import { ConsoleCaptureNotifier } from '@/orders/infrastructure/mocks/console-capture-notifier';
import { DeterministicOrderGatewayAdapter } from '@/orders/infrastructure/mocks/deterministic-order-gateway';
import { SimulatedUkCourierAdapter } from '@/orders/infrastructure/mocks/simulated-uk-courier';
import { OrderRepository } from '@/orders/infrastructure/order-repository';
import { OrderController } from '@/orders/services/order-controller';
import {
  CreateApprovedSupportTicketHandler,
  RevokeSupportTicketHandler,
} from '@/support/application/support-ticket-commands';
import { ListBrandSupportTicketsHandler } from '@/support/application/support-ticket-queries';
import { SupportTicketRepository } from '@/support/infrastructure/support-ticket-repository';
import { SupportController } from '@/support/services/support-controller';

export type { RequestContext };

type RedisClientType = typeof redisClient;

let createChildScope: (inputs: {
  readonly request: RequestContext;
  readonly log: AppLogger;
}) => RequestScope = () => {
  throw new Error('rootContainer not initialized');
};

export const DI_TOKENS = {
  CORE: {
    REQUEST: 'request',
    LOG: 'log',
    // Split CQRS database handles: read-only DbReader/ReadRepository vs. transactional UnitOfWork
    READ_DB: 'readDb',
    UOW: 'uow',
    READ_REPO: 'readRepo',
    REDIS: 'redis',
    EVENT_BUS: 'eventBus',
    EVENT_STORE: 'eventStore',
    SAGA_REPO: 'sagaRepo',
    IDEMPOTENCY_STORE: 'idempotencyStore',
    CLOCK: 'clock',
    AUTHZ: 'authz',
    COMMAND_BUS: 'commandBus',
    QUERY_BUS: 'queryBus',
  },
  IAM: {
    ROLE_PERMISSION_CACHE: 'rolePermissionCache',
    BRAND_ONBOARDING_HANDLER: 'brandIamOnboardingHandler',
    LOGIN_POS_STAFF_HANDLER: 'loginPosStaffHandler',
    SWITCH_POS_BRANCH_HANDLER: 'switchPosBranchHandler',
    GET_ASSIGNABLE_PERMISSIONS_HANDLER: 'getAssignablePermissionsHandler',
    GET_CURRENT_ACTOR_HANDLER: 'getCurrentActorHandler',
    GET_RESTAURANT_STAFF_ROLES_HANDLER: 'getRestaurantStaffRolesHandler',
    CREATE_STAFF_ROLE_HANDLER: 'createStaffRoleHandler',
    UPDATE_STAFF_ROLE_HANDLER: 'updateStaffRoleHandler',
    DELETE_STAFF_ROLE_HANDLER: 'deleteStaffRoleHandler',
    ASSIGN_STAFF_BRANCH_ACCESS_HANDLER: 'assignStaffBranchAccessHandler',
    CONTROLLER: 'iamController',
  },
  BRAND: {
    BRANCH_STATUS_CACHE: 'branchStatusCache',
    ONBOARDING_SAGA: 'brandOnboardingSaga',
    LIST_BRANDS_HANDLER: 'listBrandsHandler',
    RESOLVE_BRAND_BY_HANDLE_HANDLER: 'resolveBrandByHandleHandler',
    RESOLVE_BRANCH_BY_SLUG_HANDLER: 'resolveBranchBySlugHandler',
    REGISTER_BRAND_HANDLER: 'registerBrandHandler',
    CREATE_BRAND_BRANCH_HANDLER: 'createBrandBranchHandler',
    UPDATE_BRANCH_STATUS_HANDLER: 'updateBranchStatusHandler',
    UPDATE_BRANCH_SETTINGS_HANDLER: 'updateBranchSettingsHandler',
    REVIEW_TAKEAWAY_WHITELIST_HANDLER: 'reviewTakeawayWhitelistHandler',
    CREATE_RESTAURANT_BY_ADMIN_HANDLER: 'createRestaurantByAdminHandler',
    UPDATE_RESTAURANT_STATUS_BY_ADMIN_HANDLER: 'updateRestaurantStatusByAdminHandler',
    CONTROLLER: 'brandController',
  },
  CATALOG: {
    REPO: 'catalogRepo',
    BRAND_ONBOARDING_HANDLER: 'brandCatalogOnboardingHandler',
    BRANCH_SYNC_SAGA: 'branchCatalogSyncSaga',
    GET_MENU_SNAPSHOT_HANDLER: 'getMenuSnapshotHandler',
    UPSERT_PRICING_POLICY_HANDLER: 'upsertPricingPolicyHandler',
    UPSERT_BRANCH_MENU_OVERRIDE_HANDLER: 'upsertBranchMenuOverrideHandler',
    REVIEW_PRICE_OVERRIDE_HANDLER: 'reviewPriceOverrideHandler',
    CREATE_MENU_ITEM_HANDLER: 'createMenuItemHandler',
    UPDATE_ITEM_PRICE_HANDLER: 'updateItemPriceHandler',
    CONTROLLER: 'catalogController',
  },
  ORDERS: {
    REPO: 'orderRepo',
    CART_SERVICE: 'cartService',
    GATEWAY: 'orderGateway',
    DELIVERY_PROVIDER: 'deliveryProvider',
    NOTIFIER: 'notifier',
    ORDER_SAGA: 'orderSaga',
    CHECKOUT_SAGA: 'orderCheckoutSaga',
    PREVIEW_ORDER_HANDLER: 'previewOrderHandler',
    CHECKOUT_ORDER_HANDLER: 'checkoutOrderHandler',
    PLACE_ORDER_HANDLER: 'placePosOrderHandler',
    TRANSITION_ORDER_HANDLER: 'transitionOrderStatusHandler',
    SETTLE_ORDER_HANDLER: 'settlePosOrderHandler',
    SYNC_POS_ORDERS_HANDLER: 'syncPosOrdersHandler',
    GET_ORDERS_HANDLER: 'getRestaurantOrdersHandler',
    GET_ORDER_BY_ID_HANDLER: 'getOrderByIdHandler',
    GET_ORDER_EVENTS_SINCE_HANDLER: 'getOrderEventsSinceHandler',
    CONTROLLER: 'orderController',
  },
  BILLING: {
    REPO: 'billingRepo',
    GATEWAY: 'paymentGateway',
    CARD_TERMINAL: 'cardTerminal',
    SETTLEMENT_SERVICE: 'billingSettlementService',
    SETTLEMENT_SERVICE_FACTORY: 'billingSettlementServiceFactory',
    EVENT_HANDLER: 'billingSettlementEventHandler',
    GET_RESTAURANT_BILLING_HANDLER: 'getRestaurantBillingHandler',
    REFUND_ORDER_HANDLER: 'refundOrderHandler',
    SETTLE_MERCHANT_HANDLER: 'settleMerchantHandler',
    CONTROLLER: 'billingController',
  },
  LOYALTY: {
    REPO: 'loyaltyRepo',
    SETTLEMENT_SERVICE: 'loyaltySettlementService',
    SETTLEMENT_SERVICE_FACTORY: 'loyaltySettlementServiceFactory',
    EVENT_HANDLER: 'loyaltySettlementEventHandler',
    GET_CUSTOMER_LOYALTY_HANDLER: 'getCustomerLoyaltyHandler',
    UPDATE_GOVERNANCE_HANDLER: 'updateLoyaltyGovernanceHandler',
    AUDIT_ENTRY_HANDLER: 'auditLoyaltyEntryHandler',
    CONTROLLER: 'loyaltyController',
  },
  SUPPORT: {
    REPO: 'supportTicketRepository',
    ACCESS_PORT: 'supportAccessPort',
    CREATE_TICKET_HANDLER: 'createApprovedSupportTicketHandler',
    REVOKE_TICKET_HANDLER: 'revokeSupportTicketHandler',
    LIST_TICKETS_HANDLER: 'listBrandSupportTicketsHandler',
    CONTROLLER: 'supportController',
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
  readDb: Spec<DbReader, 'singleton'>;
  uow: Spec<UnitOfWork, 'singleton'>;
  readRepo: Spec<ReadRepository, 'singleton'>;
  redis: Spec<RedisClientType, 'singleton'>;
  eventBus: Spec<EventBus, 'singleton'>;
  eventStore: Spec<PgEventStore, 'singleton'>;
  sagaRepo: Spec<PgSagaRepository, 'singleton'>;
  idempotencyStore: Spec<RedisIdempotencyStore, 'singleton'>;
  clock: Spec<SystemClock, 'singleton'>;
  authz: WithRequirements<Spec<AuthorizationPolicy, 'scoped'>, 'request'>;
};

const eventBus = new InMemoryEventBus();
export const sharedIdempotencyStore = new RedisIdempotencyStore(redisClient);

const coreContainer: Container<CoreDeps> = new Container()
  .declareScopeInputs<{
    request: RequestContext;
    log: AppLogger;
  }>()
  .registerValue(DI_TOKENS.CORE.READ_DB, dbReader)
  .registerValue(DI_TOKENS.CORE.UOW, unitOfWork)
  .registerClass(
    DI_TOKENS.CORE.READ_REPO,
    ReadRepository,
    [
      DI_TOKENS.CORE.READ_DB,
    ],
    'singleton',
  )
  .registerValue(DI_TOKENS.CORE.REDIS, redisClient)
  // Domain Event Bus (pub/sub for async DomainEvents; separate from request-scoped CQRS CommandBus & QueryBus).
  .registerValue<typeof DI_TOKENS.CORE.EVENT_BUS, EventBus>(DI_TOKENS.CORE.EVENT_BUS, eventBus)
  .registerValue(DI_TOKENS.CORE.IDEMPOTENCY_STORE, sharedIdempotencyStore)
  .registerClass(DI_TOKENS.CORE.CLOCK, SystemClock, [], 'singleton')
  .registerClass(
    DI_TOKENS.CORE.EVENT_STORE,
    PgEventStore,
    [
      DI_TOKENS.CORE.UOW,
    ],
    'singleton',
  )
  .registerClass(
    DI_TOKENS.CORE.SAGA_REPO,
    PgSagaRepository,
    [
      DI_TOKENS.CORE.UOW,
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

// Declaring Brand bounded context:
// Manages brand registration, multi-branch provisioning, daily operational status,
// home-kitchen address privacy, and all-or-nothing `BrandOnboardingSaga` coordination.

type BrandProvides = {
  branchStatusCache: Spec<BranchStatusCache, 'singleton'>;
  brandOnboardingSaga: Spec<BrandOnboardingSaga, 'singleton'>;
  listBrandsHandler: Spec<ListBrandsHandler, 'singleton'>;
  resolveBrandByHandleHandler: WithRequirements<
    Spec<ResolveBrandByHandleHandler, 'scoped'>,
    'request'
  >;
  resolveBranchBySlugHandler: WithRequirements<
    Spec<ResolveBranchBySlugHandler, 'scoped'>,
    'request'
  >;
  registerBrandHandler: WithRequirements<Spec<RegisterBrandHandler, 'scoped'>, 'request'>;
  createBrandBranchHandler: WithRequirements<Spec<CreateBrandBranchHandler, 'scoped'>, 'request'>;
  updateBranchStatusHandler: WithRequirements<
    Spec<UpdateBranchOperationalStatusHandler, 'scoped'>,
    'request'
  >;
  updateBranchSettingsHandler: WithRequirements<
    Spec<UpdateBranchSettingsHandler, 'scoped'>,
    'request'
  >;
  reviewTakeawayWhitelistHandler: WithRequirements<
    Spec<ReviewTakeawayWhitelistHandler, 'scoped'>,
    'request'
  >;
  createRestaurantByAdminHandler: WithRequirements<
    Spec<CreateRestaurantByAdminHandler, 'scoped'>,
    'request'
  >;
  updateRestaurantStatusByAdminHandler: WithRequirements<
    Spec<UpdateRestaurantStatusByAdminHandler, 'scoped'>,
    'request'
  >;
};

const brandModule = defineBoundedContext<BrandProvides>({
  name: 'Brand',
  commandDeps: [
    DI_TOKENS.BRAND.REGISTER_BRAND_HANDLER,
    DI_TOKENS.BRAND.CREATE_BRAND_BRANCH_HANDLER,
    DI_TOKENS.BRAND.UPDATE_BRANCH_STATUS_HANDLER,
    DI_TOKENS.BRAND.UPDATE_BRANCH_SETTINGS_HANDLER,
    DI_TOKENS.BRAND.REVIEW_TAKEAWAY_WHITELIST_HANDLER,
    DI_TOKENS.BRAND.CREATE_RESTAURANT_BY_ADMIN_HANDLER,
    DI_TOKENS.BRAND.UPDATE_RESTAURANT_STATUS_BY_ADMIN_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.BRAND.LIST_BRANDS_HANDLER,
    DI_TOKENS.BRAND.RESOLVE_BRAND_BY_HANDLE_HANDLER,
    DI_TOKENS.BRAND.RESOLVE_BRANCH_BY_SLUG_HANDLER,
  ],
  module: (container) =>
    container
      .registerClass(
        DI_TOKENS.BRAND.BRANCH_STATUS_CACHE,
        BranchStatusCache,
        [
          DI_TOKENS.CORE.REDIS,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.BRAND.ONBOARDING_SAGA,
        BrandOnboardingSaga,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.SAGA_REPO,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.BRAND.LIST_BRANDS_HANDLER,
        ListBrandsHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.BRAND.RESOLVE_BRAND_BY_HANDLE_HANDLER,
        ResolveBrandByHandleHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
          DI_TOKENS.BRAND.BRANCH_STATUS_CACHE,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BRAND.RESOLVE_BRANCH_BY_SLUG_HANDLER,
        ResolveBranchBySlugHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
          DI_TOKENS.BRAND.BRANCH_STATUS_CACHE,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BRAND.REGISTER_BRAND_HANDLER,
        RegisterBrandHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BRAND.CREATE_BRAND_BRANCH_HANDLER,
        CreateBrandBranchHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BRAND.UPDATE_BRANCH_STATUS_HANDLER,
        UpdateBranchOperationalStatusHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.BRAND.BRANCH_STATUS_CACHE,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BRAND.UPDATE_BRANCH_SETTINGS_HANDLER,
        UpdateBranchSettingsHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BRAND.REVIEW_TAKEAWAY_WHITELIST_HANDLER,
        ReviewTakeawayWhitelistHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BRAND.CREATE_RESTAURANT_BY_ADMIN_HANDLER,
        CreateRestaurantByAdminHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BRAND.UPDATE_RESTAURANT_STATUS_BY_ADMIN_HANDLER,
        UpdateRestaurantStatusByAdminHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      ),
  commands: (c, commandBus) => {
    commandBus.register('RegisterBrand', c.get(DI_TOKENS.BRAND.REGISTER_BRAND_HANDLER));
    commandBus.register('CreateBrandBranch', c.get(DI_TOKENS.BRAND.CREATE_BRAND_BRANCH_HANDLER), {
      requiredPermission: 'brand:branches:create',
    });
    commandBus.register(
      'UpdateBranchOperationalStatus',
      c.get(DI_TOKENS.BRAND.UPDATE_BRANCH_STATUS_HANDLER),
      {
        requiredPermission: 'branch:status:manage',
      },
    );
    commandBus.register(
      'UpdateBranchSettings',
      c.get(DI_TOKENS.BRAND.UPDATE_BRANCH_SETTINGS_HANDLER),
      {
        requiredPermission: 'branch:settings:manage',
      },
    );
    commandBus.register(
      'ReviewTakeawayWhitelist',
      c.get(DI_TOKENS.BRAND.REVIEW_TAKEAWAY_WHITELIST_HANDLER),
      {
        requiredPermission: 'branch:whitelist:manage',
      },
    );
    commandBus.register(
      'CreateRestaurantByAdmin',
      c.get(DI_TOKENS.BRAND.CREATE_RESTAURANT_BY_ADMIN_HANDLER),
      {
        requiredPermission: 'platform:restaurants:manage',
      },
    );
    commandBus.register(
      'UpdateRestaurantStatusByAdmin',
      c.get(DI_TOKENS.BRAND.UPDATE_RESTAURANT_STATUS_BY_ADMIN_HANDLER),
      {
        requiredPermission: 'platform:restaurants:manage',
      },
    );
  },
  queries: (c, queryBus) => {
    queryBus.register('ListBrands', c.get(DI_TOKENS.BRAND.LIST_BRANDS_HANDLER));
    queryBus.register(
      'ResolveBrandByHandle',
      c.get(DI_TOKENS.BRAND.RESOLVE_BRAND_BY_HANDLE_HANDLER),
    );
    queryBus.register('ResolveBranchBySlug', c.get(DI_TOKENS.BRAND.RESOLVE_BRANCH_BY_SLUG_HANDLER));
  },
  subscribers: (scope, bus) => {
    scope.get(DI_TOKENS.BRAND.ONBOARDING_SAGA).register(bus);
  },
});

// Declaring iAm bounded context:
// Handles POS staff shift authentication, global Better Auth actor resolution, and
// dynamic tenant PBAC role/permission management. Handlers that read `DI_TOKENS.CORE.REQUEST`
// are 'scoped' per request; `RolePermissionCache` is a 'singleton' backed by Redis.

type IamProvides = {
  rolePermissionCache: Spec<RolePermissionCache, 'singleton'>;
  loginPosStaffHandler: Spec<LoginPosStaffHandler, 'singleton'>;
  switchPosBranchHandler: WithRequirements<Spec<SwitchPosBranchHandler, 'scoped'>, 'request'>;
  getAssignablePermissionsHandler: Spec<GetAssignablePermissionsHandler, 'singleton'>;
  getCurrentActorHandler: WithRequirements<Spec<GetCurrentActorHandler, 'scoped'>, 'request'>;
  getRestaurantStaffRolesHandler: WithRequirements<
    Spec<GetRestaurantStaffRolesHandler, 'scoped'>,
    'request'
  >;
  createStaffRoleHandler: WithRequirements<Spec<CreateStaffRoleHandler, 'scoped'>, 'request'>;
  updateStaffRoleHandler: WithRequirements<Spec<UpdateStaffRoleHandler, 'scoped'>, 'request'>;
  deleteStaffRoleHandler: WithRequirements<Spec<DeleteStaffRoleHandler, 'scoped'>, 'request'>;
  assignStaffBranchAccessHandler: WithRequirements<
    Spec<AssignStaffBranchAccessHandler, 'scoped'>,
    'request'
  >;
  brandIamOnboardingHandler: Spec<BrandIamOnboardingHandler, 'singleton'>;
};

const iamModule = defineBoundedContext<IamProvides>({
  name: 'Iam',
  commandDeps: [
    DI_TOKENS.IAM.LOGIN_POS_STAFF_HANDLER,
    DI_TOKENS.IAM.SWITCH_POS_BRANCH_HANDLER,
    DI_TOKENS.IAM.CREATE_STAFF_ROLE_HANDLER,
    DI_TOKENS.IAM.UPDATE_STAFF_ROLE_HANDLER,
    DI_TOKENS.IAM.DELETE_STAFF_ROLE_HANDLER,
    DI_TOKENS.IAM.ASSIGN_STAFF_BRANCH_ACCESS_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.IAM.GET_CURRENT_ACTOR_HANDLER,
    DI_TOKENS.IAM.GET_ASSIGNABLE_PERMISSIONS_HANDLER,
    DI_TOKENS.IAM.GET_RESTAURANT_STAFF_ROLES_HANDLER,
  ],
  module: (container) =>
    container
      .registerClass(
        DI_TOKENS.IAM.ROLE_PERMISSION_CACHE,
        RolePermissionCache,
        [
          DI_TOKENS.CORE.READ_REPO,
          DI_TOKENS.CORE.REDIS,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.IAM.LOGIN_POS_STAFF_HANDLER,
        LoginPosStaffHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.IAM.ROLE_PERMISSION_CACHE,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.IAM.SWITCH_POS_BRANCH_HANDLER,
        SwitchPosBranchHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.IAM.ROLE_PERMISSION_CACHE,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.IAM.GET_ASSIGNABLE_PERMISSIONS_HANDLER,
        GetAssignablePermissionsHandler,
        [],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.IAM.GET_CURRENT_ACTOR_HANDLER,
        GetCurrentActorHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.IAM.GET_RESTAURANT_STAFF_ROLES_HANDLER,
        GetRestaurantStaffRolesHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
          DI_TOKENS.CORE.AUTHZ,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.IAM.CREATE_STAFF_ROLE_HANDLER,
        CreateStaffRoleHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.IAM.UPDATE_STAFF_ROLE_HANDLER,
        UpdateStaffRoleHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.IAM.ROLE_PERMISSION_CACHE,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.IAM.DELETE_STAFF_ROLE_HANDLER,
        DeleteStaffRoleHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.IAM.ROLE_PERMISSION_CACHE,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.IAM.ASSIGN_STAFF_BRANCH_ACCESS_HANDLER,
        AssignStaffBranchAccessHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.IAM.ROLE_PERMISSION_CACHE,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.IAM.BRAND_ONBOARDING_HANDLER,
        BrandIamOnboardingHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
        ],
        'singleton',
      ),
  commands: (c, commandBus) => {
    commandBus.register('LoginPosStaff', c.get(DI_TOKENS.IAM.LOGIN_POS_STAFF_HANDLER));
    commandBus.register('SwitchPosBranch', c.get(DI_TOKENS.IAM.SWITCH_POS_BRANCH_HANDLER));
    commandBus.register('CreateStaffRole', c.get(DI_TOKENS.IAM.CREATE_STAFF_ROLE_HANDLER), {
      requiredPermission: 'staff:roles:manage',
    });
    commandBus.register('UpdateStaffRole', c.get(DI_TOKENS.IAM.UPDATE_STAFF_ROLE_HANDLER), {
      requiredPermission: 'staff:roles:manage',
    });
    commandBus.register('DeleteStaffRole', c.get(DI_TOKENS.IAM.DELETE_STAFF_ROLE_HANDLER), {
      requiredPermission: 'staff:roles:manage',
    });
    commandBus.register(
      'AssignStaffBranchAccess',
      c.get(DI_TOKENS.IAM.ASSIGN_STAFF_BRANCH_ACCESS_HANDLER),
      {
        requiredPermission: 'staff:manage',
      },
    );
  },
  queries: (c, queryBus) => {
    queryBus.register('GetCurrentActor', c.get(DI_TOKENS.IAM.GET_CURRENT_ACTOR_HANDLER));
    queryBus.register(
      'GetAssignablePermissions',
      c.get(DI_TOKENS.IAM.GET_ASSIGNABLE_PERMISSIONS_HANDLER),
      {
        requiredPermission: 'staff:roles:manage',
      },
    );
    queryBus.register(
      'GetRestaurantStaffRoles',
      c.get(DI_TOKENS.IAM.GET_RESTAURANT_STAFF_ROLES_HANDLER),
      {
        requiredPermission: 'staff:roles:manage',
      },
    );
  },
  subscribers: (scope, bus) => {
    scope.get(DI_TOKENS.IAM.BRAND_ONBOARDING_HANDLER).register(bus);
  },
});

// Declaring Catalog bounded context:
// Manages menu categories, items, modifiers, pricing policies, branch menu overrides,
// and compiled JSONB + Redis menu snapshots via `BranchCatalogSyncSaga`.

type CatalogProvides = {
  catalogRepo: Spec<CatalogRepository, 'singleton'>;
  brandCatalogOnboardingHandler: Spec<BrandCatalogOnboardingHandler, 'singleton'>;
  branchCatalogSyncSaga: Spec<BranchCatalogSyncSaga, 'singleton'>;
  getMenuSnapshotHandler: Spec<GetBranchMenuSnapshotHandler, 'singleton'>;
  upsertPricingPolicyHandler: WithRequirements<
    Spec<UpsertPricingPolicyHandler, 'scoped'>,
    'request'
  >;
  upsertBranchMenuOverrideHandler: WithRequirements<
    Spec<UpsertBranchMenuOverrideHandler, 'scoped'>,
    'request'
  >;
  reviewPriceOverrideHandler: WithRequirements<
    Spec<ReviewPriceOverrideHandler, 'scoped'>,
    'request'
  >;
  createMenuItemHandler: WithRequirements<Spec<CreateMenuItemHandler, 'scoped'>, 'request'>;
  updateItemPriceHandler: WithRequirements<Spec<UpdateMenuItemPriceHandler, 'scoped'>, 'request'>;
};

const catalogModule = defineBoundedContext<CatalogProvides>({
  name: 'Catalog',
  commandDeps: [
    DI_TOKENS.CATALOG.UPSERT_PRICING_POLICY_HANDLER,
    DI_TOKENS.CATALOG.UPSERT_BRANCH_MENU_OVERRIDE_HANDLER,
    DI_TOKENS.CATALOG.REVIEW_PRICE_OVERRIDE_HANDLER,
    DI_TOKENS.CATALOG.CREATE_MENU_ITEM_HANDLER,
    DI_TOKENS.CATALOG.UPDATE_ITEM_PRICE_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.CATALOG.GET_MENU_SNAPSHOT_HANDLER,
  ],
  module: (container) =>
    container
      .registerClass(
        DI_TOKENS.CATALOG.REPO,
        CatalogRepository,
        [
          DI_TOKENS.CORE.UOW,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.CATALOG.BRAND_ONBOARDING_HANDLER,
        BrandCatalogOnboardingHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.CATALOG.BRANCH_SYNC_SAGA,
        BranchCatalogSyncSaga,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CATALOG.REPO,
          DI_TOKENS.CORE.REDIS,
          DI_TOKENS.CORE.SAGA_REPO,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.CATALOG.GET_MENU_SNAPSHOT_HANDLER,
        GetBranchMenuSnapshotHandler,
        [
          DI_TOKENS.CATALOG.REPO,
          DI_TOKENS.CORE.REDIS,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.CATALOG.UPSERT_PRICING_POLICY_HANDLER,
        UpsertPricingPolicyHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.CATALOG.UPSERT_BRANCH_MENU_OVERRIDE_HANDLER,
        UpsertBranchMenuOverrideHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.CATALOG.REVIEW_PRICE_OVERRIDE_HANDLER,
        ReviewPriceOverrideHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.CATALOG.CREATE_MENU_ITEM_HANDLER,
        CreateMenuItemHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
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
      'UpsertPricingPolicy',
      c.get(DI_TOKENS.CATALOG.UPSERT_PRICING_POLICY_HANDLER),
      {
        requiredPermission: 'pricing:policy:manage',
      },
    );
    commandBus.register(
      'UpsertBranchMenuOverride',
      c.get(DI_TOKENS.CATALOG.UPSERT_BRANCH_MENU_OVERRIDE_HANDLER),
    );
    commandBus.register(
      'ReviewPriceOverride',
      c.get(DI_TOKENS.CATALOG.REVIEW_PRICE_OVERRIDE_HANDLER),
      {
        requiredPermission: 'catalog:price:approve',
      },
    );
    commandBus.register('CreateMenuItem', c.get(DI_TOKENS.CATALOG.CREATE_MENU_ITEM_HANDLER), {
      requiredPermission: 'catalog:items:manage',
    });
    commandBus.register('UpdateMenuItemPrice', c.get(DI_TOKENS.CATALOG.UPDATE_ITEM_PRICE_HANDLER), {
      requiredPermission: 'catalog:price:update',
    });
  },
  queries: (c, queryBus) => {
    queryBus.register('GetBranchMenuSnapshot', c.get(DI_TOKENS.CATALOG.GET_MENU_SNAPSHOT_HANDLER));
  },
  subscribers: (scope, bus) => {
    scope.get(DI_TOKENS.CATALOG.BRAND_ONBOARDING_HANDLER).register(bus);
    scope.get(DI_TOKENS.CATALOG.BRANCH_SYNC_SAGA).register(bus);
  },
});

// Declaring Support bounded context:
// Manages brand-authorized JIT support tickets (including catalog update add-on attachments)
// and exposes `supportAccessPort` so `iam` middleware can validate `X-Support-Ticket-Id`.

type SupportProvides = {
  supportTicketRepository: WithRequirements<Spec<SupportTicketRepository, 'scoped'>, 'request'>;
  supportAccessPort: WithRequirements<Spec<SupportAccessPort, 'scoped'>, 'request'>;
  createApprovedSupportTicketHandler: WithRequirements<
    Spec<CreateApprovedSupportTicketHandler, 'scoped'>,
    'request'
  >;
  revokeSupportTicketHandler: WithRequirements<
    Spec<RevokeSupportTicketHandler, 'scoped'>,
    'request'
  >;
  listBrandSupportTicketsHandler: WithRequirements<
    Spec<ListBrandSupportTicketsHandler, 'scoped'>,
    'request'
  >;
};

const supportModule = defineBoundedContext<SupportProvides>({
  name: 'Support',
  commandDeps: [
    DI_TOKENS.SUPPORT.CREATE_TICKET_HANDLER,
    DI_TOKENS.SUPPORT.REVOKE_TICKET_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.SUPPORT.LIST_TICKETS_HANDLER,
  ],
  module: (container) =>
    container
      .registerClass(
        DI_TOKENS.SUPPORT.REPO,
        SupportTicketRepository,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerFactory(
        DI_TOKENS.SUPPORT.ACCESS_PORT,
        (c): SupportAccessPort => c.get(DI_TOKENS.SUPPORT.REPO),
        [
          DI_TOKENS.SUPPORT.REPO,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.SUPPORT.CREATE_TICKET_HANDLER,
        CreateApprovedSupportTicketHandler,
        [
          DI_TOKENS.SUPPORT.REPO,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.SUPPORT.REVOKE_TICKET_HANDLER,
        RevokeSupportTicketHandler,
        [
          DI_TOKENS.SUPPORT.REPO,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.SUPPORT.LIST_TICKETS_HANDLER,
        ListBrandSupportTicketsHandler,
        [
          DI_TOKENS.SUPPORT.REPO,
          DI_TOKENS.CORE.AUTHZ,
        ],
        'scoped',
      ),
  commands: (c, commandBus) => {
    commandBus.register(
      'CreateApprovedSupportTicket',
      c.get(DI_TOKENS.SUPPORT.CREATE_TICKET_HANDLER),
      {
        requiredPermission: 'brand:support:authorize',
      },
    );
    commandBus.register('RevokeSupportTicket', c.get(DI_TOKENS.SUPPORT.REVOKE_TICKET_HANDLER), {
      requiredPermission: 'brand:support:authorize',
    });
  },
  queries: (c, queryBus) => {
    queryBus.register('ListBrandSupportTickets', c.get(DI_TOKENS.SUPPORT.LIST_TICKETS_HANDLER), {
      requiredPermission: 'brand:support:authorize',
    });
  },
});

// Declaring Loyalty bounded context:
// Owns customer and merchant loyalty wallets, expiring point batches, governance rules,
// and audit adjustments. Subscribes to `LoyaltyHoldRequested`, `BillingSettlementRecorded`,
// `OrderCancelledOrRejected`, and `MerchantLoyaltyOffsetRequested` domain events.

type LoyaltyProvides = {
  loyaltyRepo: WithRequirements<Spec<LoyaltyRepository, 'scoped'>, 'request'>;
  loyaltySettlementService: WithRequirements<Spec<LoyaltySettlementService, 'scoped'>, 'request'>;
  loyaltySettlementServiceFactory: Spec<ScopedFactory<LoyaltySettlementService>, 'singleton'>;
  loyaltySettlementEventHandler: Spec<LoyaltySettlementEventHandler, 'singleton'>;
  getCustomerLoyaltyHandler: WithRequirements<Spec<GetCustomerLoyaltyHandler, 'scoped'>, 'request'>;
  updateLoyaltyGovernanceHandler: WithRequirements<
    Spec<UpdateLoyaltyGovernanceHandler, 'scoped'>,
    'request'
  >;
  auditLoyaltyEntryHandler: WithRequirements<Spec<AuditLoyaltyEntryHandler, 'scoped'>, 'request'>;
};

const loyaltyModule = defineBoundedContext<LoyaltyProvides>({
  name: 'Loyalty',
  commandDeps: [
    DI_TOKENS.LOYALTY.UPDATE_GOVERNANCE_HANDLER,
    DI_TOKENS.LOYALTY.AUDIT_ENTRY_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.LOYALTY.GET_CUSTOMER_LOYALTY_HANDLER,
  ],

  module: (container) =>
    container
      .registerValue<
        typeof DI_TOKENS.LOYALTY.SETTLEMENT_SERVICE_FACTORY,
        ScopedFactory<LoyaltySettlementService>
      >(DI_TOKENS.LOYALTY.SETTLEMENT_SERVICE_FACTORY, (request) => {
        const scope = createChildScope({
          request,
          log: new AppLogger(request.requestId),
        });
        return {
          service: scope.get(DI_TOKENS.LOYALTY.SETTLEMENT_SERVICE),
          dispose: () => scope.dispose(),
        };
      })
      .registerClass(
        DI_TOKENS.LOYALTY.EVENT_HANDLER,
        LoyaltySettlementEventHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.LOYALTY.SETTLEMENT_SERVICE_FACTORY,
          DI_TOKENS.CORE.EVENT_BUS,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.LOYALTY.REPO,
        LoyaltyRepository,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.LOYALTY.SETTLEMENT_SERVICE,
        LoyaltySettlementService,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.LOYALTY.REPO,
          DI_TOKENS.CORE.CLOCK,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.LOYALTY.GET_CUSTOMER_LOYALTY_HANDLER,
        GetCustomerLoyaltyHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
          DI_TOKENS.LOYALTY.REPO,
          DI_TOKENS.CORE.AUTHZ,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.LOYALTY.UPDATE_GOVERNANCE_HANDLER,
        UpdateLoyaltyGovernanceHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.LOYALTY.AUDIT_ENTRY_HANDLER,
        AuditLoyaltyEntryHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.LOYALTY.REPO,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      ),
  commands: (c, commandBus) => {
    commandBus.register(
      'UpdateLoyaltyGovernance',
      c.get(DI_TOKENS.LOYALTY.UPDATE_GOVERNANCE_HANDLER),
    );
    commandBus.register('AuditLoyaltyEntry', c.get(DI_TOKENS.LOYALTY.AUDIT_ENTRY_HANDLER));
  },
  queries: (c, queryBus) => {
    queryBus.register('GetCustomerLoyalty', c.get(DI_TOKENS.LOYALTY.GET_CUSTOMER_LOYALTY_HANDLER), {
      requiredPermission: 'loyalty:read',
    });
  },
  subscribers: (scope, bus) => {
    scope.get(DI_TOKENS.LOYALTY.EVENT_HANDLER).register(bus);
  },
});

// Declaring Billing bounded context:
// Enforces double-entry UK VAT/commission accounting (`GATEWAY_CLEARING`, merchant net,
// platform fee, HMRC VAT), gateway/terminal adapters, refunds, and B2B merchant payouts.
// Subscribes to `OrderSettlementFinancialsRequested` and `MerchantLoyaltyOffsetApplied`.

type BillingProvides = {
  billingRepo: WithRequirements<Spec<BillingRepository, 'scoped'>, 'request'>;
  paymentGateway: Spec<DeterministicMockGateway, 'singleton'>;
  cardTerminal: Spec<MockCardTerminalAdapter, 'singleton'>;
  billingSettlementService: WithRequirements<Spec<BillingSettlementService, 'scoped'>, 'request'>;
  billingSettlementServiceFactory: Spec<ScopedFactory<BillingSettlementService>, 'singleton'>;
  billingSettlementEventHandler: Spec<BillingSettlementEventHandler, 'singleton'>;
  getRestaurantBillingHandler: WithRequirements<
    Spec<GetRestaurantBillingHandler, 'scoped'>,
    'request'
  >;
  refundOrderHandler: WithRequirements<Spec<RefundOrderHandler, 'scoped'>, 'request'>;
  settleMerchantHandler: WithRequirements<Spec<SettleMerchantHandler, 'scoped'>, 'request'>;
};

const billingModule = defineBoundedContext<BillingProvides>({
  name: 'Billing',
  commandDeps: [
    DI_TOKENS.BILLING.REFUND_ORDER_HANDLER,
    DI_TOKENS.BILLING.SETTLE_MERCHANT_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.BILLING.GET_RESTAURANT_BILLING_HANDLER,
  ],
  module: (container) =>
    container
      .registerValue<
        typeof DI_TOKENS.BILLING.SETTLEMENT_SERVICE_FACTORY,
        ScopedFactory<BillingSettlementService>
      >(DI_TOKENS.BILLING.SETTLEMENT_SERVICE_FACTORY, (request) => {
        const scope = createChildScope({
          request,
          log: new AppLogger(request.requestId),
        });
        return {
          service: scope.get(DI_TOKENS.BILLING.SETTLEMENT_SERVICE),
          dispose: () => scope.dispose(),
        };
      })
      .registerClass(
        DI_TOKENS.BILLING.EVENT_HANDLER,
        BillingSettlementEventHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.BILLING.SETTLEMENT_SERVICE_FACTORY,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.BILLING.REPO,
        BillingRepository,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(DI_TOKENS.BILLING.GATEWAY, DeterministicMockGateway, [], 'singleton')
      .registerClass(DI_TOKENS.BILLING.CARD_TERMINAL, MockCardTerminalAdapter, [], 'singleton')
      .registerClass(
        DI_TOKENS.BILLING.SETTLEMENT_SERVICE,
        BillingSettlementService,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.BILLING.REPO,
          DI_TOKENS.CORE.EVENT_BUS,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BILLING.GET_RESTAURANT_BILLING_HANDLER,
        GetRestaurantBillingHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
          DI_TOKENS.BILLING.REPO,
          DI_TOKENS.CORE.AUTHZ,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BILLING.REFUND_ORDER_HANDLER,
        RefundOrderHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.BILLING.REPO,
          DI_TOKENS.BILLING.GATEWAY,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.BILLING.SETTLE_MERCHANT_HANDLER,
        SettleMerchantHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.BILLING.REPO,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      ),
  commands: (c, commandBus) => {
    commandBus.register('RefundOrder', c.get(DI_TOKENS.BILLING.REFUND_ORDER_HANDLER), {
      requiredPermission: 'orders:settle',
    });
    commandBus.register('SettleMerchant', c.get(DI_TOKENS.BILLING.SETTLE_MERCHANT_HANDLER));
  },
  queries: (c, queryBus) => {
    queryBus.register(
      'GetRestaurantBilling',
      c.get(DI_TOKENS.BILLING.GET_RESTAURANT_BILLING_HANDLER),
      {
        requiredPermission: 'ledger:read',
      },
    );
  },
  subscribers: (scope, bus) => {
    scope.get(DI_TOKENS.BILLING.EVENT_HANDLER).register(bus);
  },
});

// Declaring Orders bounded context:
// Owns storefront carts, authoritative order pricing/checkout, POS order placement,
// KDS ticket routing, named status state machines, offline POS sync, and 3PL webhooks.
// Subscribes `OrderSettlementSaga` and `OrderCheckoutSaga` to coordinate billing and
// loyalty handoffs asynchronously via `EventBus` and `PgSagaRepository`.

type OrdersProvides = {
  orderRepo: WithRequirements<Spec<OrderRepository, 'scoped'>, 'request'>;
  cartService: Spec<RedisCartService, 'singleton'>;
  orderGateway: Spec<DeterministicOrderGatewayAdapter, 'singleton'>;
  deliveryProvider: Spec<SimulatedUkCourierAdapter, 'singleton'>;
  notifier: Spec<ConsoleCaptureNotifier, 'singleton'>;
  orderSaga: Spec<OrderSettlementSaga, 'singleton'>;
  orderCheckoutSaga: WithRequirements<Spec<OrderCheckoutSaga, 'scoped'>, 'request'>;
  previewOrderHandler: Spec<PreviewOrderHandler, 'singleton'>;
  checkoutOrderHandler: WithRequirements<Spec<CheckoutOrderHandler, 'scoped'>, 'request'>;
  placePosOrderHandler: WithRequirements<Spec<PlacePosOrderHandler, 'scoped'>, 'request'>;
  transitionOrderStatusHandler: WithRequirements<
    Spec<TransitionOrderStatusHandler, 'scoped'>,
    'request'
  >;
  settlePosOrderHandler: WithRequirements<Spec<SettlePosOrderHandler, 'scoped'>, 'request'>;
  syncPosOrdersHandler: WithRequirements<Spec<SyncPosOrdersHandler, 'scoped'>, 'request'>;
  getRestaurantOrdersHandler: WithRequirements<
    Spec<GetRestaurantOrdersHandler, 'scoped'>,
    'request'
  >;
  getOrderByIdHandler: WithRequirements<Spec<GetOrderByIdHandler, 'scoped'>, 'request'>;
  getOrderEventsSinceHandler: Spec<GetOrderEventsSinceHandler, 'singleton'>;
};

const ordersModule = defineBoundedContext<OrdersProvides>({
  name: 'Orders',
  commandDeps: [
    DI_TOKENS.ORDERS.PREVIEW_ORDER_HANDLER,
    DI_TOKENS.ORDERS.CHECKOUT_ORDER_HANDLER,
    DI_TOKENS.ORDERS.PLACE_ORDER_HANDLER,
    DI_TOKENS.ORDERS.TRANSITION_ORDER_HANDLER,
    DI_TOKENS.ORDERS.SETTLE_ORDER_HANDLER,
    DI_TOKENS.ORDERS.SYNC_POS_ORDERS_HANDLER,
  ],
  queryDeps: [
    DI_TOKENS.ORDERS.GET_ORDERS_HANDLER,
    DI_TOKENS.ORDERS.GET_ORDER_BY_ID_HANDLER,
    DI_TOKENS.ORDERS.GET_ORDER_EVENTS_SINCE_HANDLER,
  ],
  module: (container) =>
    container
      .registerClass(
        DI_TOKENS.ORDERS.REPO,
        OrderRepository,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_STORE,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.ORDERS.CART_SERVICE,
        RedisCartService,
        [
          DI_TOKENS.CORE.REDIS,
        ],
        'singleton',
      )
      .registerClass(DI_TOKENS.ORDERS.GATEWAY, DeterministicOrderGatewayAdapter, [], 'singleton')
      .registerClass(DI_TOKENS.ORDERS.DELIVERY_PROVIDER, SimulatedUkCourierAdapter, [], 'singleton')
      .registerClass(DI_TOKENS.ORDERS.NOTIFIER, ConsoleCaptureNotifier, [], 'singleton')
      .registerClass(
        DI_TOKENS.ORDERS.ORDER_SAGA,
        OrderSettlementSaga,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.SAGA_REPO,
          DI_TOKENS.ORDERS.NOTIFIER,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.ORDERS.CHECKOUT_SAGA,
        OrderCheckoutSaga,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.CORE.EVENT_BUS,
          DI_TOKENS.CORE.SAGA_REPO,
          DI_TOKENS.ORDERS.REPO,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.ORDERS.PREVIEW_ORDER_HANDLER,
        PreviewOrderHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
        ],
        'singleton',
      )
      .registerClass(
        DI_TOKENS.ORDERS.CHECKOUT_ORDER_HANDLER,
        CheckoutOrderHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.ORDERS.REPO,
          DI_TOKENS.ORDERS.CART_SERVICE,
          DI_TOKENS.ORDERS.GATEWAY,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.ORDERS.PLACE_ORDER_HANDLER,
        PlacePosOrderHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.ORDERS.REPO,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.ORDERS.TRANSITION_ORDER_HANDLER,
        TransitionOrderStatusHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.ORDERS.REPO,
          DI_TOKENS.ORDERS.DELIVERY_PROVIDER,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.ORDERS.SETTLE_ORDER_HANDLER,
        SettlePosOrderHandler,
        [
          DI_TOKENS.ORDERS.REPO,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.ORDERS.SYNC_POS_ORDERS_HANDLER,
        SyncPosOrdersHandler,
        [
          DI_TOKENS.CORE.UOW,
          DI_TOKENS.ORDERS.REPO,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.ORDERS.GET_ORDERS_HANDLER,
        GetRestaurantOrdersHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
          DI_TOKENS.CORE.AUTHZ,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.ORDERS.GET_ORDER_BY_ID_HANDLER,
        GetOrderByIdHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
          DI_TOKENS.CORE.AUTHZ,
          DI_TOKENS.CORE.REQUEST,
        ],
        'scoped',
      )
      .registerClass(
        DI_TOKENS.ORDERS.GET_ORDER_EVENTS_SINCE_HANDLER,
        GetOrderEventsSinceHandler,
        [
          DI_TOKENS.CORE.READ_REPO,
        ],
        'singleton',
      ),
  commands: (c, commandBus) => {
    commandBus.register('PreviewOrder', c.get(DI_TOKENS.ORDERS.PREVIEW_ORDER_HANDLER));
    commandBus.register('CheckoutOrder', c.get(DI_TOKENS.ORDERS.CHECKOUT_ORDER_HANDLER));
    commandBus.register('PlacePosOrder', c.get(DI_TOKENS.ORDERS.PLACE_ORDER_HANDLER), {
      requiredPermission: 'orders:place',
    });
    commandBus.register('TransitionOrderStatus', c.get(DI_TOKENS.ORDERS.TRANSITION_ORDER_HANDLER));
    commandBus.register('SettlePosOrder', c.get(DI_TOKENS.ORDERS.SETTLE_ORDER_HANDLER), {
      requiredPermission: 'orders:settle',
    });
    commandBus.register('SyncPosOrders', c.get(DI_TOKENS.ORDERS.SYNC_POS_ORDERS_HANDLER), {
      requiredPermission: 'orders:place',
    });
  },
  queries: (c, queryBus) => {
    queryBus.register('GetRestaurantOrders', c.get(DI_TOKENS.ORDERS.GET_ORDERS_HANDLER), {
      requiredPermission: 'orders:read',
    });
    queryBus.register('GetOrderById', c.get(DI_TOKENS.ORDERS.GET_ORDER_BY_ID_HANDLER));
    queryBus.register(
      'GetOrderEventsSince',
      c.get(DI_TOKENS.ORDERS.GET_ORDER_EVENTS_SINCE_HANDLER),
    );
  },
  subscribers: (scope, bus) => {
    scope.get(DI_TOKENS.ORDERS.ORDER_SAGA).register(bus);
    scope.get(DI_TOKENS.ORDERS.CHECKOUT_SAGA).register(bus);
  },
});

// ============================================================================
// REGISTERING BOUNDED CONTEXTS & COMPOSING ROOT CONTAINER
// 1. `BOUNDED_CONTEXTS` drives automatic CQRS bus and event subscriber wiring.
// 2. `domainContainer` merges all strictly isolated bounded context modules.
// 3. `rootContainer` registers request-scoped CQRS buses and HTTP controllers.
// ============================================================================

const BOUNDED_CONTEXTS = [
  brandModule,
  iamModule,
  supportModule,
  catalogModule,
  loyaltyModule,
  billingModule,
  ordersModule,
] as const;

// Composes all strictly isolated bounded context modules onto `coreContainer`.
// Every module depends solely on `CoreDeps` and communicates across boundaries via `EventBus`.
const domainContainer = coreContainer
  .use(iamModule.module)
  .use(supportModule.module)
  .use(brandModule.module)
  .use(catalogModule.module)
  .use(loyaltyModule.module)
  .use(billingModule.module)
  .use(ordersModule.module);

export type DomainResolved = Container.Resolve<typeof domainContainer>;

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
    DI_TOKENS.BRAND.CONTROLLER,
    BrandController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
      DI_TOKENS.CORE.REQUEST,
    ],
    'scoped',
  )
  .registerClass(
    DI_TOKENS.IAM.CONTROLLER,
    IamController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
      DI_TOKENS.CORE.REQUEST,
    ],
    'scoped',
  )
  .registerClass(
    DI_TOKENS.SUPPORT.CONTROLLER,
    SupportController,
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
      DI_TOKENS.CORE.REQUEST,
    ],
    'scoped',
  )
  .registerClass(
    DI_TOKENS.LOYALTY.CONTROLLER,
    LoyaltyController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
      DI_TOKENS.CORE.REQUEST,
    ],
    'scoped',
  )
  .registerClass(
    DI_TOKENS.BILLING.CONTROLLER,
    BillingController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
      DI_TOKENS.CORE.REQUEST,
    ],
    'scoped',
  )
  .registerClass(
    DI_TOKENS.ORDERS.CONTROLLER,
    OrderController,
    [
      DI_TOKENS.CORE.COMMAND_BUS,
      DI_TOKENS.CORE.QUERY_BUS,
      DI_TOKENS.ORDERS.CART_SERVICE,
      DI_TOKENS.ORDERS.REPO,
      DI_TOKENS.ORDERS.DELIVERY_PROVIDER,
      DI_TOKENS.CORE.EVENT_BUS,
      DI_TOKENS.CORE.REQUEST,
    ],
    'scoped',
  );

createChildScope = (inputs) => rootContainer.createScope(inputs);

export interface ScopeServices {
  request: RequestContext;
  log: AppLogger;
  readDb: DbReader;
  uow: UnitOfWork;
  readRepo: ReadRepository;
  redis: RedisClientType;
  eventBus: EventBus;
  eventStore: PgEventStore;
  sagaRepo: PgSagaRepository;
  idempotencyStore: RedisIdempotencyStore;
  clock: SystemClock;
  authz: AuthorizationPolicy;
  commandBus: CommandBus;
  queryBus: QueryBus;
  rolePermissionCache: RolePermissionCache;
  iamController: IamController;
  supportTicketRepository: SupportTicketRepository;
  supportAccessPort: SupportAccessPort;
  supportController: SupportController;
  brandIamOnboardingHandler: BrandIamOnboardingHandler;
  branchStatusCache: BranchStatusCache;
  brandOnboardingSaga: BrandOnboardingSaga;
  brandController: BrandController;
  catalogRepo: CatalogRepository;
  brandCatalogOnboardingHandler: BrandCatalogOnboardingHandler;
  branchCatalogSyncSaga: BranchCatalogSyncSaga;
  catalogController: CatalogController;
  loyaltyRepo: LoyaltyRepository;
  loyaltySettlementService: LoyaltySettlementService;
  loyaltySettlementEventHandler: LoyaltySettlementEventHandler;
  loyaltyController: LoyaltyController;
  billingRepo: BillingRepository;
  paymentGateway: DeterministicMockGateway;
  cardTerminal: MockCardTerminalAdapter;
  billingSettlementService: BillingSettlementService;
  billingSettlementEventHandler: BillingSettlementEventHandler;
  billingController: BillingController;
  orderRepo: OrderRepository;
  cartService: RedisCartService;
  orderGateway: DeterministicOrderGatewayAdapter;
  deliveryProvider: SimulatedUkCourierAdapter;
  notifier: ConsoleCaptureNotifier;
  orderSaga: OrderSettlementSaga;
  orderCheckoutSaga: OrderCheckoutSaga;
  orderController: OrderController;
}

export interface RequestScope {
  get<K extends keyof ScopeServices>(key: K): ScopeServices[K];
  dispose(): Promise<void>;
}

// Subscribes all domain event listeners to the process-wide `InMemoryEventBus`.
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
    actorId: BOOTSTRAP_ACTOR_ID,
    actorSource: 'ANONYMOUS',
    permissions: [],
  },
  log: new AppLogger('bootstrap'),
});

registerDomainEventSubscribers(bootScope, eventBus);

export type AppEnv = InferdiHonoScopeEnv<RequestScope>;
