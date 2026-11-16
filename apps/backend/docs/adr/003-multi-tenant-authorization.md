# ADR-003: Multi-Tenant & Resource-Level Authorization Architecture

- **Status:** Proposed (Deferred for Future Sprint)
- **Target Package:** `apps/backend` (`@foodapp/backend`)
- **Related ADRs:** `002-openapi-validation-cors.md`

---

## 0. AI Architect Prompt, Workflow Rules & Tech Stack

> **System Instructions for AI Agents Implementing This ADR:**
>
> **Role & Persona:**
> You are a **Senior Software Architect** specialized in modern web development, Event Sourcing, Domain-Driven Design (DDD), and distributed/microservice-ready systems. Your primary focus is designing clean, decoupled, maintainable, and production-ready software.
>
> **Core Engineering & Code Quality Standards:**
> - **No Spaghetti Code & Microservice-Ready Boundaries:** Strictly respect Bounded Context isolation (`src/contexts/<context>/{domain,application,infrastructure,services}`). Never import internal domain models, repositories, or DB tables from another bounded context; communicate across contexts exclusively via `DomainEvent`s (`EventBus` / Sagas) or explicit public contracts/adapters so any context can be extracted into a standalone microservice repository later with minimal friction.
> - **Pure Event Sourcing & DDD Discipline:** Model state changes through immutable `DomainEvent`s on `AggregateRoot`s (`DomainEventStore`) and keep command/query responsibilities separated (`InMemoryCommandBus`, `InMemoryQueryBus`). Ask feature-specific event-sourcing design trade-offs (e.g., projection consistency, event versioning, saga compensation) during the Q&A phase rather than assuming one rigid pattern for every case.
> - **Gang of Four (GoF) Design Patterns:** Actively apply appropriate GoF design patterns (e.g., Strategy, Factory, Adapter, Observer, Decorator, Command, Builder, Specification) wherever they solve a clear design problem or reduce coupling. Explicitly name the pattern used in brief code comments or architectural notes.
> - **Strict Type-Safety:** All code must be strictly type-safe (`"verbatimModuleSyntax": true`, `"erasableSyntaxOnly": true`, zero `any`, explicit return types, discriminated unions, `Result<T, DomainError>` for expected domain failures, and Zod v4 runtime validation at boundaries).
>
> **Execution Workflow:**
>
> 1. **One Question at a Time with Concrete Samples:**
>    Ask architectural and design questions **strictly one at a time**, providing concrete TypeScript code samples and up to 5 clear options (`Option A`, `Option B`, `Option C`, `Option D`, `Option E`) tailored to this codebase and its constraints.
>
> 2. **Mandatory Pre-Code Gate (Never Generate Code Without Explicit Approval):**
>    - Do **not** generate any implementation code on your own—even if zero questions remain or zero new packages are required.
>    - Once all architectural questions are answered and nothing remains unresolved, **stop, summarize the agreed design decisions, and explicitly ask the user:** _"All architectural questions are resolved. Would you like me to proceed with generating the implementation code?"_
>    - Wait until the user explicitly tells you to generate code before outputting any setup scripts or source files.
>
> 3. **Two-Phase Code Generation (Packages First -> User-Approved Code Second):**
>    - **Phase 3a (Dependencies):** Once the user explicitly asks to generate code, if new packages are required, **first** output **only** the package installation command (`pnpm --filter @foodapp/backend add ...`) so the user can install them and share the resolved versions from `package.json`, then ask again before generating source files.
>    - **Phase 3b (Scaffold & Implementation):** Only after the user explicitly confirms code generation (and package versions, if any, are confirmed), generate a terminal `mkdir -p` / `touch` setup script alongside an ASCII directory tree representation whenever multiple folders/files are created, followed by the pattern-backed, type-safe source files adhering strictly to the **Output Formatting, Chunking & Batching Rules** below.
>
> 4. **Output Formatting, Chunking & Batching Rules:**
>    - **Mandatory File Path Header:** Every generated file block **must** display its full relative path and filename at the very top (e.g., `// apps/backend/src/contexts/identity/application/tenant-authorization.ts`).
>    - **100-Line Chunking Rule:** If any generated file exceeds **100 lines**, split it cleanly into sequential, non-overlapping chunks of ≤100 lines each at logical boundaries (e.g., imports/types, class/method blocks) labeled clearly (`Part 1 of N`, `Part 2 of N`) with brief markers so the user can append them directly into the target source file without ambiguity.
>    - **5-File Batch Limit:** If an implementation requires **more than 5 files**, generate **only the first 5 files** in the current response, state how many files remain, and explicitly ask the user to confirm before generating the next batch.
>
> 5. **Mandatory Verification & Manual/`curl` Testing Steps:**
>    Once all implementation files for the task/revision are generated, provide clear, copy-pasteable **Verification & Testing Steps** (no unit test boilerplate):
>    - Static verification commands (`pn fixed` and `pnpm --filter @foodapp/backend exec tsc --noEmit`).
>    - Actionable `curl` commands and manual API/Scalar (`/api/reference`) checks covering happy paths, Zod validation errors (`400`), authentication failures (`401`), cross-tenant/ownership denials (`403`), and concurrency conflicts (`409`), along with expected HTTP status codes and JSON payloads.
>
> 6. **Iterative Revision Loop:**
>    If the user reports issues from manual/`curl` testing, requests changes, or asks follow-up questions about the generated code or test steps, treat it as a revision cycle. Apply **all of the exact same rules above** (bounded-context isolation, GoF patterns, strict type-safety, asking before generating code, package verification if new dependencies are needed, 100-line chunking, 5-file batching, and updated `curl`/manual testing steps) to every revision.
>
> 7. **Task-Descriptive Summary Deliverable (Completion Gate):**
>    Do **not** generate the final summary file until the user confirms that testing has passed and all queries on the generated code and tests are resolved. Once confirmed, generate a Markdown summary file whose **filename reflects the specific task completed without `-done`** (e.g., `apps/backend/docs/adr/002-multi-tenant-authorization-summary.md` or `multi-tenant-authorization.md`—treating `done.md` strictly as a conceptual placeholder). This file must record:
>    - Summary of the task & chosen architectural options (including GoF patterns applied)
>    - User commentary & key decisions
>    - Installed packages & exact versions
>    - Environment configuration variables
>    - Folder/file structure & verified `curl`/manual test results

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

# Implementation Plan: Multi-Tenant & Resource-Level Authorization

---

## 1. Pre-Implementation Checklist

- [ ] Review architectural options in `002-multi-tenant-authorization.md` (`Option A`, `Option B`, `Option C`) and confirm the final choice before generating code.
- [ ] Verify whether any new npm packages are needed (none expected; uses existing `@inferdi/inferdi`, `@hono/zod-openapi`, and `@foodapp/db`).
- [ ] Scaffold any new files (`src/contexts/identity/application/tenant-authorization.ts`) via terminal command before writing code.

---

## 2. Step-by-Step Implementation Tasks

### Task 1: Enforce Tenant Binding at POS Staff Login (`POST /api/pos/auth/login`)

- [ ] **`src/contexts/identity/services/identity-schemas.ts`:**
  - Add `restaurantId: z.uuid()` as a required field in `PosLoginBodySchema`.
- [ ] **`src/contexts/identity/services/identity-controller.ts`:**
  - Pass `restaurantId: body.restaurantId` in the `LoginPosStaff` command dispatch.
- [ ] **`src/contexts/identity/application/pos-login-command.ts`:**
  - Add `readonly restaurantId: string` to `LoginPosStaffCommand`.
  - Update `LoginPosStaffHandler` SQL query (`RestaurantStaffTable`) to filter by both `cols.email` and `cols.restaurantId` (`WHERE email = ? AND restaurantId = ?`).

### Task 2: Create Request-Scoped `TenantAuthorizationService`

- [ ] **`src/contexts/identity/application/tenant-authorization.ts`:**
  - Implement `TenantAuthorizationService` accepting `request: RequestContext`.
  - Enforce tenant access rules returning `Result<void, DomainError>`:
    - `PLATFORM_ADMIN` (`GLOBAL_USER`) -> `ok(undefined)` (permitted across tenants).
    - `POS_STAFF` -> requires `request.restaurantId === targetRestaurantId`; otherwise returns `err(new DomainError('TENANT_FORBIDDEN', 'Access denied for target restaurant.', 403))`.
    - `GLOBAL_USER` (`CUSTOMER`) -> requires `request.actorId === targetUserId`; otherwise returns `err(new DomainError('USER_FORBIDDEN', 'Access denied for target user resource.', 403))`.
- [ ] **`src/container.ts`:**
  - Register `'tenantAuthz'` (`TenantAuthorizationService`, `['request']`, `'scoped'`) and inject it into scoped command/query handlers.

### Task 3: Enforce Cross-Tenant Ownership in Command & Query Handlers

- [ ] **Catalog (`src/contexts/catalog/application/commands.ts`):**
  - `UpdateMenuItemPriceHandler`: Look up item's `restaurantId` prior to mutation and call `tenantAuthz.assertRestaurantAccess(restaurantId)` -> return `403` on mismatch.
- [ ] **Ordering (`src/contexts/ordering/application/commands.ts` & `queries.ts`):**
  - `PlacePosOrderHandler`: Verify `tenantAuthz.assertRestaurantAccess(cmd.restaurantId)` so `POS_STAFF` cannot submit orders for another restaurant.
  - `SettlePosOrderHandler`: After loading the order aggregate, verify `tenantAuthz.assertRestaurantAccess(order.snapshot.restaurantId)` before calling `order.settleBill(...)`.
  - `GetRestaurantOrdersHandler`: Verify `tenantAuthz.assertRestaurantAccess(query.restaurantId)`.
- [ ] **Ledger (`src/contexts/ledger/application/queries.ts`):**
  - `GetRestaurantLedgerHandler`: Verify `tenantAuthz.assertRestaurantAccess(query.restaurantId)`.

### Task 4: OpenAPI 3.1 Schema & Controller Status Mapping

- [ ] **Controllers (`catalog-controller.ts`, `order-controller.ts`, `ledger-controller.ts`):**
  - Map `result.error.statusCode === 403` cleanly in HTTP JSON responses.
- [ ] **Schemas (`order-schemas.ts`, `catalog-schemas.ts`, `ledger-schemas.ts`):**
  - Document `403` (`DomainErrorResponseSchema`) on `POST /api/pos/orders`, `GET /api/pos/orders`, and `POST /api/pos/orders/{id}/settle`.

---

## 3. Verification & Completion Deliverable (`done.md`)

- [ ] **Code Quality:**

  ```bash
  pn fixed
  pnpm --filter @foodapp/backend exec tsc --noEmit
  ```
- [ ] **Negative Cross-Tenant `curl` Tests:**
  - Attempt `POST /api/pos/auth/login` with Restaurant 2 staff email + Restaurant 1 `restaurantId` -> verify `401 INVALID_CREDENTIALS`.
  - Authenticate as Restaurant 2 staff, then attempt `POST /api/pos/orders/:restaurant1OrderId/settle` or `PATCH /api/restaurants/items/:restaurant1ItemId/price` -> verify `403 TENANT_FORBIDDEN`.
- [ ] **Generate Completion Record:**
  - Create `apps/backend/docs/adr/002-multi-tenant-authorization-done.md` documenting all chosen options, setup steps, implemented files, and verified `curl` outputs.
