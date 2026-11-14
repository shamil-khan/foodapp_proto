# ADR-002: Multi-Tenant & Resource-Level Authorization Architecture

- **Status:** Proposed (Deferred for Future Sprint)
- **Target Package:** `apps/backend` (`@foodapp/backend`)
- **Related ADRs:** `002-openapi-validation-cors.md`

---

## 0. AI Architect Prompt, Workflow Rules & Tech Stack

> **System Instructions for AI Agents Implementing This ADR:**
>
> 1. **No Premature Code Generation:** Do **not** generate implementation code until all architectural questions are answered and the user explicitly asks to generate code.
> 2. **One Question at a Time with Concrete Samples:** Ask architectural/design questions **strictly one at a time**, providing concrete TypeScript code samples and clear options (`Option A`, `Option B`, `Option C`) tailored to this codebase.
> 3. **Two-Phase Code Generation (Packages First -> Version-Verified Code Second):**
>    - When the user asks to generate code, **first** output **only** the package installation command (`pnpm --filter @foodapp/backend add ...`) if new packages are required, so the user can install them and share the resolved versions from `package.json`.
>    - **Second**, once package versions are confirmed (or immediately if zero new packages are needed), generate a terminal `mkdir -p` / `touch` setup script alongside an ASCII directory tree representation whenever multiple folders/files are created, followed by the version-accurate source files.
> 4. **Mandatory `done.md` Summary Deliverable:** At the end of implementation, generate a `done.md` file recording all chosen options, user commentary, installed packages & versions, environment configuration, folder/file setup, code summary, and `curl`/automated verification steps.
> 5. **Strict Stack & Architecture Adherence:** Do not introduce ORMs, alternative DI containers, or unvalidated route handlers.

### Tech Stack & Coding Priorities

- **Monorepo & Tooling:** `pnpm` workspaces + Turborepo (`apps/backend`, `packages/db`), Biome (`pn fixed` / `biome check --write src`), TypeScript (`"module": "preserve"`, `"moduleResolution": "bundler"`, `"verbatimModuleSyntax": true`, `"erasableSyntaxOnly": true`, extensionless `@/*` path aliases).
- **Runtime & HTTP Framework:** Node.js + `tsx watch src/index.ts`, **Hono** (`^4.13.16`), **`@hono/zod-openapi`** (`^1.6.3`), **`@scalar/hono-api-reference`** (`^0.12.20`), **`zod`** (`^4.6.7` — always import `z` from `'@hono/zod-openapi'` and use Zod v4 top-level formats like `z.uuid()`, `z.email()`).
- **Architectural Style:** Domain-Driven Design (DDD), CQRS (`InMemoryCommandBus`, `InMemoryQueryBus`), Event Sourcing (`DomainEventStore`, `AggregateRoot`, `OrderSettlementSaga`), and `Specification<T>` (`src/core/patterns/specification.ts`).
- **Dependency Injection:** `@inferdi/inferdi` (`^6.1.1`) + `@inferdi/hono` (`^6.1.1`) via `rootContainer` in `src/container.ts`:
  - `'singleton'`: `db`, `redis`, `eventBus`, `eventStore`, `sagaRepo`, repositories, query handlers, event/saga handlers.
  - `'scoped'`: `request` (`RequestContext`), `log` (`AppLogger`), `commandBus`, `queryBus`, command handlers, controllers, and authorization policy services.
- **Database Layer:** PostgreSQL 18 + `@foodapp/db` (`*Table` constants + `*Row`/`*Insert` types, `sqlSelect`, `sqlInsert`, `sqlUpdate`, `sqlSoftDelete`).
- **Authentication:**
  - Global Users (`CUSTOMER`, `DRIVER`, `PLATFORM_ADMIN`): Better Auth (`^1.7.20`) with `bearer()` + `phoneNumber` OTP (customers have **no** passwords).
  - POS Tenant Staff (`OWNER`, `ADMIN`, `MANAGER`, `ORDER_TAKER`): HS256 JWT (`pos_staff_token`) issued via `POST /api/pos/auth/login` (`restaurantId` + `email` + `password`).
- **Observability & Error Handling:** `@logtape/logtape` (`AsyncLocalStorage` + `withContext({ requestId })`), typed `Result<T, DomainError>` mapped to HTTP status codes (`400`, `401`, `403`, `404`, `409 CONCURRENCY_CONFLICT`).
- **Coding Priorities:**
  1. Keep `*-routes.ts` thin (`OpenAPIHono<AppEnv>` + `openApiValidationHook`), passing validated `c.req.valid(...)` payloads to typed controller methods.
  2. Enforce authorization in domain/application layers using typed `Result<T, DomainError>` (`403` status code) rather than ad-hoc `if` checks inside controllers.
  3. Document all `403 Forbidden` responses in `*-schemas.ts` so `/api/doc` and `/api/reference` stay accurate.
  4. Verify every change with `pn fixed` and `pnpm --filter @foodapp/backend exec tsc --noEmit`.

---

## 1. Context & Problem Statement

In a multi-tenant restaurant POS and storefront platform (`restaurantId = 1, 2, 3, ...`), authentication alone (`POS_STAFF` JWT or `GLOBAL_USER` session) only proves _who_ the caller is—not whether they are authorized to view or mutate a specific tenant's resources.

Without explicit tenant & resource-level authorization, a staff member authenticated for **Restaurant 1** could potentially pass an ID belonging to **Restaurant 2** or **Restaurant 3** and access or modify another tenant's data.

---

## 2. Three-Layer Authorization Model

To avoid scattered ad-hoc `if` checks across controllers and handlers, authorization is structured into three distinct layers:

1. **Layer 1 — Identity & Tenant Binding (Authentication / Login):**
   - Verifies credentials _and_ tenant membership at login (`restaurantId` + `email` + `password` for POS staff).
   - Binds `actorId`, `actorSource`, `tenantRole` / `globalRole`, and `restaurantId` into the request-scoped `RequestContext` (`@inferdi/hono`).
2. **Layer 2 — Route-Level RBAC (Coarse-Grained Role Middleware):**
   - Enforced via Hono middlewares (`requirePosStaff([...])`, `requireGlobalUser([...])`).
   - Answers: _"Does this actor's role have permission to invoke this endpoint at all?"_
3. **Layer 3 — Domain / Resource-Level Tenant Authorization (Fine-Grained Ownership):**
   - Enforced inside application command/query handlers before state mutations or sensitive reads.
   - Answers: _"Does this actor own or belong to the target `restaurantId`, `orderId`, `menuItemId`, or `userId`?"_

---

## 3. Audit of Current Tenant Isolation Gaps (To Address When Implementing)

| Layer / Endpoint                                         | Current Behavior                                                                                                                                                              | Required Hardening                                                                                                                    |
| :------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| **`POST /api/pos/auth/login`**                           | `PosLoginBodySchema` only accepts `email` & `password` (stripping `restaurantId`), and `LoginPosStaffHandler` queries `RestaurantStaffTable` by `email` only.                 | Require `restaurantId: z.uuid()` in `PosLoginBodySchema` and filter `WHERE email = ? AND restaurantId = ?` in `LoginPosStaffHandler`. |
| **`PATCH /api/restaurants/items/:itemId/price`**         | `CatalogRepository.updateItemPrice` updates `MenuItemTable` by `menuItemId` + `expectedRowVersion` without checking if the item's category belongs to `request.restaurantId`. | Verify target item's `restaurantId === request.restaurantId` (unless `PLATFORM_ADMIN`), returning `403 FORBIDDEN`.                    |
| **`POST /api/pos/orders/:id/settle`**                    | `SettlePosOrderHandler` loads the order aggregate by `orderId` without checking `order.snapshot.restaurantId === request.restaurantId`.                                       | Verify `order.snapshot.restaurantId === request.restaurantId` (unless `PLATFORM_ADMIN`), returning `403 FORBIDDEN`.                   |
| **`POST /api/pos/orders`**                               | Uses `this.request.restaurantId ?? body.restaurantId`.                                                                                                                        | Ensure `POS_STAFF` cannot override `this.request.restaurantId` with a different `body.restaurantId` (`403 FORBIDDEN` on mismatch).    |
| **`GET /api/pos/orders` & `GET /api/ledger/restaurant`** | Uses `this.request.restaurantId ?? query.restaurantId`.                                                                                                                       | Reject with `403 FORBIDDEN` if `POS_STAFF` passes a `query.restaurantId` that differs from `this.request.restaurantId`.               |
| **Customer Loyalty & Orders**                            | Uses `this.request.actorId` directly from session.                                                                                                                            | Keep `actorId` bound strictly to authenticated `GLOBAL_USER` session; verify order ownership if order-linked redemption is validated. |

---

## 4. Architectural Options Evaluated

### Option A: Request-Scoped `TenantAuthorizationService` Injected via `@inferdi/inferdi` _(Recommended)_

Create a dedicated `TenantAuthorizationService` (or Domain `Specification<T>` built on `src/core/patterns/specification.ts`) registered in `rootContainer` with `['request']` scope:

- Centralizes tenant rules in one auditable class:
  - `PLATFORM_ADMIN` -> permitted across tenants (with audit logging).
  - `POS_STAFF` -> strictly requires `request.restaurantId === targetRestaurantId`, otherwise returns `err(new DomainError('TENANT_FORBIDDEN', '...', 403))`.
  - `GLOBAL_USER` -> strictly requires `request.actorId === targetUserId`.
- Command and query handlers invoke `this.tenantAuthz.assertRestaurantAccess(restaurantId)` and propagate `Result<T, DomainError>` (`403`).

### Option B: Repository-Level Mandatory Tenant Scoping

Require `restaurantId` as a mandatory filter parameter in every repository method (`updateItemPrice({ menuItemId, restaurantId, ... })`, `findById(orderId, restaurantId)`).

- _Pros:_ Enforced directly in SQL `WHERE` clauses.
- _Cons:_ Returns generic `404` / `409` instead of explicit `403 Forbidden` domain errors, and complicates `PLATFORM_ADMIN` cross-tenant operations.

### Option C: Hybrid (`TenantAuthorizationService` + Login `restaurantId` Enforcement)

Combine **Option A** (`403` domain policy checks in handlers + `PLATFORM_ADMIN` support) with strict `restaurantId` validation at `POST /api/pos/auth/login`.

---

## 5. Planned Implementation Checklist (When Scheduled)

1. **Login Tenant Binding:**
   - Add `restaurantId: z.uuid()` to `PosLoginBodySchema` (`src/contexts/identity/services/identity-schemas.ts`).
   - Pass `restaurantId` through `IdentityController.loginPosStaff` -> `LoginPosStaffCommand` -> `LoginPosStaffHandler` (`WHERE email = ? AND restaurantId = ?`).
2. **Authorization Policy Service:**
