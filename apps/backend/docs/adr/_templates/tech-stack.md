# Backend Tech Stack & System Architecture Baseline (`@foodapp/backend`)

> **Living Document Rule:** Update this file at **Step 8 (Post-Task Living Doc Sync)** whenever packages, environment variables, bounded contexts, DI registrations, or cross-cutting policies change.
> **API Endpoint Reference:** Raw HTTP routes, request schemas, and response payloads are auto-documented via OpenAPI 3.1 at `/api/doc` and Scalar UI at `/api/reference`—do not duplicate raw route tables here.

---

## 1. Monorepo, Tooling & Compiler Settings

- **Monorepo:** `pnpm` workspaces + Turborepo (`apps/backend`, `packages/db`)
- **Local Infrastructure:** Podman Compose (`compose.yaml`) running PostgreSQL 18 (`foodapp-pg` on `5432`) and Redis 8 (`foodapp-redis` on `6379`)
- **Linter & Formatter:** Biome (`pn fixed` / `biome check --write src`) + `sql-formatter` for migrations/seeds
- **TypeScript Configuration (`apps/backend/tsconfig.json`):**
  - `"target": "es2023"`, `"module": "preserve"`, `"moduleResolution": "bundler"`
  - `"strict": true`, `"verbatimModuleSyntax": true`, `"erasableSyntaxOnly": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true`
  - Extensionless `@/*` path aliases (`tsx watch src/index.ts`)

---

## 2. Installed Packages & Exact Versions (`apps/backend/package.json`)

| Layer                | Package                                              | Version                           | Architectural Role & Usage Notes                                                                                 |
| :------------------- | :--------------------------------------------------- | :-------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| HTTP Framework       | `hono`                                               | `^4.13.16`                        | Thin `OpenAPIHono<AppEnv>` routers + CORS/JWT middlewares                                                        |
| Node Server          | `@hono/node-server`                                  | `^2.1.6`                          | HTTP server entrypoint (`src/index.ts`)                                                                          |
| OpenAPI & Validation | `@hono/zod-openapi`                                  | `^1.6.3`                          | Route contracts (`createRoute`), `openApiValidationHook`, `app.doc31('/api/doc')`                                |
| API Reference UI     | `@scalar/hono-api-reference`                         | `^0.12.20`                        | Interactive Scalar UI at `/api/reference`                                                                        |
| Schema Validation    | `zod`                                                | `^4.6.7`                          | Always import `z` from `'@hono/zod-openapi'`; use Zod v4 top-level `z.uuid()`, `z.email()`                       |
| Dependency Injection | `@inferdi/inferdi` / `@inferdi/hono`                 | `^6.1.1` / `^6.1.1`               | `rootContainer` + `initDiScope` (`c.var.di`)                                                                     |
| Authentication       | `better-auth`                                        | `^1.7.20`                         | Global users (`bearer()`, `phoneNumber` OTP, `admin` plugins)                                                    |
| Observability        | `@logtape/logtape`, `@logtape/file`, `@logtape/hono` | `^2.4.2`                          | `AsyncLocalStorage` + `withContext({ requestId })` + `logs/dev_YYYY-MM-DD.log`                                   |
| Database Workspace   | `@foodapp/db`                                        | `workspace:*`                     | PostgreSQL 18 (`pg`), Redis 8 (`redis`), `*Table` constants, `sqlSelect`/`sqlInsert`/`sqlUpdate`/`sqlSoftDelete` |
| Dev & Build Tooling  | `typescript` / `tsx` / `@types/node`                 | `^7.0.2` / `^4.23.15` / `^26.6.6` | Typechecking (`tsc --noEmit`) & watch runner                                                                     |

---

## 3. Environment Variables (`apps/backend/.env`)

- `DATABASE_URL` — PostgreSQL 18 connection string
- `REDIS_URL` — Redis 8 connection string (`auth:*`, `menu:snapshot:<id>`, `role:perms:<roleId>`)
- `BETTER_AUTH_SECRET` — Better Auth session & HS256 POS shift JWT signing secret
- `FRONTEND_ORIGINS` — Comma-separated allowed cross-cloud origins (`src/config/cors.ts`)
- `PORT` — HTTP server port (defaults to `3000`)

## 4. Dependency Injection Lifetimes & Modular Composition (`src/container.ts`)

- **Centralized Token Registry:** `DI_TOKENS` (`as const` object literal grouped by `CORE`, `IDENTITY`, `CATALOG`, `ORDERING`, `LEDGER`) prevents duplicate keys and complies with `"erasableSyntaxOnly": true`.
- **Context Composition Functions:** `createCoreModule` -> `registerIdentityModule` -> `registerCatalogModule` -> `registerOrderingModule` -> `registerLedgerModule`, paired with co-located `register<Context>Commands` / `register<Context>Queries` helpers and `registerDomainEventSubscribers`.
- **Scope Inputs:** `request` (`RequestContext`), `log` (`AppLogger`)
- **`'singleton'`:**
  - Core: `db` (`pgPool`), `redis` (`redisClient`), `eventBus` (`InMemoryEventBus`), `eventStore` (`PgEventStore`), `sagaRepo` (`PgSagaRepository`)
  - Caching & Repositories: `rolePermissionCache` (`RolePermissionCache`), `orderRepo`, `catalogRepo`, `ledgerRepo`
  - Stateless Handlers & Subscribers: `loginPosStaffHandler`, `getRestaurantsHandler`, `getRestaurantBySubdomainHandler`, `getMenuSnapshotHandler`, `getAssignablePermissionsHandler`, `orderSaga`, `menuCacheHandler`, `loyaltyEventHandler`
- **`'scoped'`:**
  - Policy & Buses: `authz` (`AuthorizationPolicy`), `commandBus` (`InMemoryCommandBus` with `AuthorizingCommandHandlerDecorator` + `LoggingCommandHandlerDecorator`), `queryBus` (`InMemoryQueryBus` with `AuthorizingQueryHandlerDecorator`)
  - Scoped Command/Query Handlers: `getCurrentActorHandler`, `getRestaurantStaffRolesHandler`, `createStaffRoleHandler`, `updateStaffRoleHandler`, `deleteStaffRoleHandler`, `assignStaffRoleHandler`, `createRestaurantByAdminHandler`, `updateRestaurantStatusByAdminHandler`, `placeOrderHandler`, `settleOrderHandler`, `getOrdersHandler`, `updateItemPriceHandler`, `getRestaurantLedgerHandler`, `getUserLoyaltyHandler`, `recordSettlementHandler`, `redeemLoyaltyHandler`
  - Controllers: `identityController`, `catalogController`, `orderController`, `ledgerController`

---

## 5. Current System Architecture State

- **Subdomain Multi-Tenancy (`*.fapp.com`):**
  - Each `"Restaurant"` has a unique URL-safe `subdomain` (e.g., `westminster-patty`, `smash360`) resolved publicly via `GET /api/restaurants/by-subdomain/{subdomain}`.
  - POS staff log in via `POST /api/pos/auth/login` with `{ subdomain, email, password }`, receiving an HS256 JWT (`pos_staff_token`, 12h TTL). Suspended tenants (`isActiveOverride = false`) return `403 TENANT_SUSPENDED`.
- **Dynamic Roles & Rights (PBAC) + Live Redis Revocation:**
  - Normalized `"StaffRole"` & `"StaffRolePermission"` tables per restaurant; `OWNER` role is locked (`403 SYSTEM_ROLE_LOCKED`), and roles with active staff cannot be deleted (`409 ROLE_IN_USE`).
  - `RolePermissionCache` caches `role:perms:<roleId>` in Redis (1h TTL) and invalidates immediately on role update/delete.
  - `AuthorizationPolicy` (`src/core/application/authorization.ts`) uses GoF `CompositeSpecification` (`HasPermissionSpec`, `SameRestaurantSpec`, `SameUserSpec`) to enforce capability rights (`403 INSUFFICIENT_RIGHTS`) and cross-tenant/user isolation (`403 TENANT_FORBIDDEN`, `403 USER_FORBIDDEN`).
- **Active Bounded Contexts & Mounted Routers (`src/app.ts`):**
  - `identity` (`/api/auth/**`, `/api/pos/auth/*`, `/api/me`, `/api/pos/roles/*`, `/api/pos/staff/*`)
  - `catalog` (`/api/restaurants/*` + `/api/admin/restaurants/*` for `PLATFORM_ADMIN`)
  - `ordering` (`/api/pos/orders/*` — `OrderAggregate` with GoF State + `KdsTicketVisitor` + `OrderSettlementSaga`)
    - `ledger` (`/api/ledger/restaurant`, `/api/ledger/loyalty/*` — `FinancialLedgerAggregate` double-entry accounting + `VatStrategy` (`StandardUkVatStrategy`, `ZeroRatedUkVatStrategy`), to be extended for multi-region tax workflows in a future ADR)
