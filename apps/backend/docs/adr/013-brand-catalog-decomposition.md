# ADR-013: Decompose Catalog into Isolated `brand` and `catalog` Bounded Contexts with Saga Orchestration

- **Status:** Implemented & Verified

## 1. Problem Statement & Architectural Goal

- Currently, `apps/backend/src/catalog/` bundles two distinct bounded contexts and rates of change into a single module:
  1. **Brand & Branch Tenancy (`brand`):** Brand registration (`RegisterBrandHandler`), physical branch provisioning (`CreateBrandBranchHandler`), daily operational status (`OPEN` / `BUSY_PAUSED` / `CLOSED` / `HOLIDAY` with 1-hour Redis lock), fulfillment capabilities, opening schedules, and home-kitchen residential address privacy (`location-privacy.ts` + takeaway whitelists).
  2. **Storefront Menu & Commercial Pricing (`catalog`):** `Category`, `MenuItem`, `ItemModifier`, ingredient hashtag filtering (`#cheese`), KDS routing targets, compiled `MenuSnapshot` projections (PostgreSQL JSONB + Redis cache), `PricingPolicy` workflows (`CENTRAL_LOCKED`, `BRANCH_DIRECT`, `BRANCH_APPROVAL_REQUIRED`, `THRESHOLD_HYBRID`), and `BranchMenuOverride` price proposals/approvals.
- Additionally, `RegisterBrandHandler` currently writes directly across `brand` (`Restaurant`, `RestaurantBranch`, `RestaurantLayout`, `PaymentConfig`), `iam` (`StaffRole`, `StaffRolePermission`, `RestaurantStaff`, `StaffBranchAssignment`), and `catalog` (`PricingPolicy`) tables in one cross-context transaction, while `CatalogRepository.rebuildAndPersistSnapshot` queries `Restaurant` and `RestaurantBranch` tables directly.
- **Architectural Goal:** Extract a dedicated `brand` bounded context (`apps/backend/src/brand/`), keep menus and pricing cohesive inside `catalog` (`apps/backend/src/catalog/`), enforce **zero cross-context SQL writes or TypeScript imports**, orchestrate multi-context brand onboarding via an all-or-nothing compensating `BrandOnboardingSaga` (`PgSagaRepository`), synchronize `MenuSnapshot` via `BranchCatalogSyncSaga`, and expose clean greenfield channel/actor URL namespaces (`/api/brands`, `/api/catalog`, `/api/pos/brands`, `/api/pos/catalog`, `/api/admin/brands`).

---

## 2. Architectural Decisions (Q&A)

### Q1. Bounded-Context Granularity (`brand` + `catalog` 2-Way Split vs. 3-Way `pricing` Split)

- **Considered Options:**
  - _Option A:_ Split into three contexts (`branch`, `catalog`, `pricing`) with cross-context sync Sagas between `pricing` and `catalog`. — **Pros:** Smaller individual folders. | **Cons:** Over-fragments tightly coupled menu items, branch price overrides, and snapshot compilation, adding unnecessary Saga hop latency.
  - _Option B (Selected):_ Split into two cohesive contexts—**`brand`** (Brand + Physical/Home/Cloud Branches + Operational Status + Location Privacy) and **`catalog`** (Categories, Menu Items, Modifiers, `MenuSnapshot`, `PricingPolicy`, `BranchMenuOverride`). — **Pros:** `Brand` (`Restaurant`) is the true DDD Aggregate Root; menu items and price overrides stay together for atomic snapshot compilation; zero cross-context imports. | **Cons:** Requires `BrandOnboardingSaga` and `BranchCatalogSyncSaga` to coordinate `brand`, `iam`, and `catalog`.
- **User Commentary & Trade-Off Evaluation:** Naming the upstream tenancy context `brand` (rather than `branch`) aligns with industry standards (Uber Eats Merchant/Store, Shopify Merchant/Location) and reflects `Restaurant` (`Brand`) as the true aggregate root. Keeping pricing inside `catalog` preserves high domain cohesion while eliminating redundant Saga hops.
- **Selected Implementation:** `apps/backend/src/brand/` owns Brand and Branch lifecycle; `apps/backend/src/catalog/` owns Menu Catalog and Pricing Policy workflows.

### Q2. Cross-Context Synchronization Between `brand` and `catalog`

- **Considered Options:**
  - _Option A (Selected):_ Pure event/Saga synchronization (`PgSagaRepository` + `ProcessedEvent`) plus a local `CatalogBranchProjection` read-model table in `catalog` so `CatalogRepository` never queries `Restaurant` or `RestaurantBranch` tables directly. — **Pros:** 100% microservice-ready bounded-context isolation; `BranchCatalogSyncSaga` rebuilds `MenuSnapshot` automatically when `BranchCreated` or `BranchSettingsUpdated` (`menuSelectionMode`) fires. | **Cons:** Adds one lightweight read-projection table (`CatalogBranchProjection`) in `packages/db`.
  - _Option B:_ Keep direct SQL reads from `catalog` against `Restaurant` and `RestaurantBranch` tables. — **Pros:** No new table. | **Cons:** Violates strict bounded-context data isolation in AP Section 2.
- **User Commentary & Trade-Off Evaluation:** Maintaining `CatalogBranchProjection` inside `catalog` guarantees zero cross-context table reads or writes between `brand` and `catalog`.
- **Selected Implementation:** Migration `013_catalog_branch_projection.sql` creates `CatalogBranchProjection` (`branchId`, `restaurantId`, `brandName`, `branchName`, `postcodeSector`, `menuSelectionMode`) maintained by `BranchCatalogSyncSaga` and `BrandOnboardingSaga`.

### Q3. Greenfield HTTP Route Namespace Design

- **Considered Options:**
  - _Option A:_ Standalone bounded-context roots (`/api/brands/*` and `/api/catalog/*`) with `/pos` nested inside each (`/api/brands/pos/*`, `/api/catalog/pos/*`). — **Pros:** 1:1 gateway prefix per context. | **Cons:** Retains `:brand` slug collision risk with `/pos`.
  - _Option B:_ Keep both `brand` and `catalog` routes mounted under `/api/brands/*`. — **Pros:** Zero URL changes. | **Cons:** Mixes catalog/pricing endpoints under `/api/brands`.
  - _Option C (Selected):_ Top-level channel/actor prefixes matching `iam`, `support`, and `orders`:
    - Public Storefront: `/api/brands` (`GET /`, `POST /register`, `GET /:brand`, `GET /:brand/:city/:branch`) and `/api/catalog` (`GET /branches/:branchId/menu`).
    - Authenticated POS / Merchant Back-Office: `/api/pos/brands` (`POST /branches`, `PATCH /branches/:branchId/status`, `PATCH /branches/:branchId/settings`, `POST /branches/:branchId/whitelist`) and `/api/pos/catalog` (`PUT /pricing-policy`, `POST /items`, `PUT /branches/:branchId/menu/:itemId`, `POST /branches/:branchId/menu/:itemId/review`).
    - Platform Admin: `/api/admin/brands` (`POST /`, `PATCH /:restaurantId/status`). — **Pros:** Eliminates `:brand` slug collisions completely, unifies `/api/pos/*` WAF/auth routing across all contexts, and fits a greenfield project with no legacy clients. | **Cons:** Updates smoke test URLs in `brands-menus-onboarding.smoke.test.ts` and `branches-pricing.smoke.test.ts`.
- **User Commentary & Trade-Off Evaluation:** Because the project is greenfield with no backward-compatibility constraints, adopting consistent top-level channel prefixes (`/api/brands`, `/api/catalog`, `/api/pos/brands`, `/api/pos/catalog`, `/api/admin/brands`) gives the cleanest REST and API Gateway contract.
- **Selected Implementation:** Separate public and POS routers in `brand-routes.ts` and `catalog-routes.ts` mounted at their respective prefixes in `apps/backend/src/app.ts`.

### Q4. Staff Branch Assignment on New Branch Creation

- **Considered Options:**
  - _Option A (Selected):_ `CreateBrandBranchHandler` in `brand` writes **only** `RestaurantBranch` (zero writes or side effects into `iam`'s `StaffBranchAssignmentTable`), and staff branch access is granted explicitly via `iam`'s `PATCH /api/pos/staff/:staffId/branch-access`. — **Pros:** 100% pure bounded-context isolation with zero hidden cross-context side effects. | **Cons:** Assigning a manager/owner to a newly created branch uses an explicit `iam` API call.
  - _Option B:_ Auto-grant brand-wide roles (`BRAND_OWNER` / `OPERATIONAL_MANAGER`) dynamic branch access in `iam` without `StaffBranchAssignment` rows. — **Pros:** No follow-up assignment call. | **Cons:** Complicates `RolePermissionCache` and `SwitchPosBranchHandler` branch lookup rules.
- **User Commentary & Trade-Off Evaluation:** Explicit `iam` assignment keeps `brand` and `iam` 100% decoupled and makes branch access grants auditable.
- **Selected Implementation:** Remove `StaffBranchAssignmentTable` insert from `CreateBrandBranchHandler` and update `pbac-roles.smoke.test.ts` to call `PATCH /api/pos/staff/:ownerStaffId/branch-access` after creating a secondary branch.

### Q5. All-or-Nothing Atomic Brand Onboarding Saga & Hard-Delete Compensation

- **Considered Options:**
  - _Option A (Selected):_ Orchestrate `POST /api/brands/register` via **`BrandOnboardingSaga`** (`PgSagaRepository` + `ProcessedEvent` idempotency):
    1. `brand` persists `Restaurant`, `RestaurantBranch`, `RestaurantLayout`, and `PaymentConfig` and emits `BrandRegistered` (with pre-generated `ownerStaffId`).
    2. `iam` handles `BrandRegistered` to seed `StaffRole`s, `StaffRolePermission`s, owner `RestaurantStaff`, and primary `StaffBranchAssignment`, emitting `BrandOwnerBootstrapped` (or `BrandOnboardingStepFailed`).
    3. `catalog` handles `BrandRegistered` to seed default `PricingPolicy` and `CatalogBranchProjection`, emitting `BrandCatalogInitialized` (or `BrandOnboardingStepFailed`).
    4. **All-or-Nothing Hard-Delete Compensation:** If either `iam` or `catalog` fails, `BrandOnboardingSaga` transitions to `COMPENSATING` -> `FAILED` and dispatches reverse-order hard `DELETE` compensation (`catalog` -> `iam` -> `brand`) so zero uncommitted orphan rows remain and table-level `UNIQUE ("handle")` / `UNIQUE ("email")` constraints are immediately freed for seller retry. — **Pros:** Strict AP Section 2 Saga compliance, zero cross-context SQL writes, atomic unit-of-work rollback, and immediate retryability. | **Cons:** Requires compensation handlers in `brand`, `iam`, and `catalog`.
  - _Option B:_ Dispatch `iam` and `catalog` commands directly over `CommandBus` without `PgSagaRepository` state tracking. — **Pros:** Fewer events. | **Cons:** Lacks durable `_Saga_State` step and compensation tracking required by AP Section 2.
- **User Commentary & Trade-Off Evaluation:** Soft-deleting a failed onboarding attempt would permanently lock `Restaurant.handle` and `RestaurantStaff.email` due to table-level `UNIQUE` constraints; hard-deleting uncommitted rows during Saga compensation guarantees clean all-or-nothing rollback and immediate retryability while `_Saga_State` retains failure diagnostics.
- **Selected Implementation:** `BrandOnboardingSaga` in `brand` + `BrandOwnerBootstrapHandler` / `CompensateBrandIamHandler` in `iam` + `BrandCatalogBootstrapHandler` / `CompensateBrandCatalogHandler` in `catalog`.

## 3. Proposed Implementation Blueprint & Agent Handover (Advisory)

> _Note for Implementing Agent: The structure, packages, and file layout below reflect the designing architect's proposed blueprint and may differ based on your own codebase inspection and judgment. Any dependency changes still require explicit user approval._

- **Bounded Contexts Impacted:** New: `brand` | Modified: `catalog`, `iam` | Split: `catalog` -> `brand`, `catalog`
- **Proposed Packages:** `None` (zero new dependencies required)
- **Existing Knowledge-Base Files (Read-Only Context to Attach):**
  - `apps/backend/docs/adr/000-agent-protocol.md` — Execution workflow, scaffold-first gate, and Saga isolation rules
  - `apps/backend/docs/adr/iam-policy-engine-jit-support-route-guards.md` — PBAC permission guards (`requirePermission`, `requireTenantOrSupportTicket`) and `SupportAccessPort`
  - `apps/backend/src/container.ts` — `DI_TOKENS` and `defineBoundedContext` module wiring
  - `apps/backend/src/app.ts` — Top-level OpenAPIHono route mounts
- **Existing Files to Modify or Remove (Proposed):**
  - `apps/backend/src/catalog/application/admin-restaurant-commands.ts` — Remove (moved to `brand/application/admin-brand-commands.ts`)
  - `apps/backend/src/catalog/application/branch-commands.ts` — Remove (moved to `brand/application/brand-commands.ts` and decoupled from `iam`/`catalog` tables)
  - `apps/backend/src/catalog/domain/location-privacy.ts` — Remove (moved to `brand/domain/location-privacy.ts`)
  - `apps/backend/src/catalog/domain/tenant-bootstrap-strategy.ts` — Remove (moved to `brand/domain/tenant-bootstrap-strategy.ts`)
  - `apps/backend/src/catalog/infrastructure/branch-status-cache.ts` — Remove (moved to `brand/infrastructure/branch-status-cache.ts`)
  - `apps/backend/src/catalog/application/queries.ts` — Slim to `GetBranchMenuSnapshotHandler` only (brand/branch queries moved to `brand/application/queries.ts`)
  - `apps/backend/src/catalog/application/cache-invalidation-handler.ts` — Replace with `BranchCatalogSyncSaga` subscribing to `BranchMenuUpdated`, `BranchCreated`, and `BranchSettingsUpdated`
  - `apps/backend/src/catalog/infrastructure/catalog-repository.ts` — Read branch metadata from `CatalogBranchProjectionTable` instead of `RestaurantTable` / `RestaurantBranchTable`
  - `apps/backend/src/catalog/services/catalog-controller.ts`, `catalog-routes.ts`, `catalog-schemas.ts` — Slim to menu & pricing endpoints mounted at `/api/catalog` and `/api/pos/catalog`
  - `apps/backend/src/iam/application/brand-onboarding-handlers.ts` (new) & `apps/backend/src/container.ts` — Register `brandModule`, `BrandOnboardingSaga`, `BranchCatalogSyncSaga`, and `iam` onboarding bootstrap/compensation handlers
  - `apps/backend/src/app.ts` — Mount `brandRoutes` (`/api/brands`), `posBrandRoutes` (`/api/pos/brands`), `adminBrandRoutes` (`/api/admin/brands`), `catalogRoutes` (`/api/catalog`), and `posCatalogRoutes` (`/api/pos/catalog`)
  - `apps/backend/tests/smoke/brands-menus-onboarding.smoke.test.ts`, `branches-pricing.smoke.test.ts`, `pbac-roles.smoke.test.ts`, `apps/backend/tests/unit/shared.route-auth-guards.spec.ts` — Update to new `/api/catalog` & `/api/pos/{brands,catalog}` routes and explicit `iam` branch assignment
- **Proposed New Files:**
  - `packages/db/migrations/013_catalog_branch_projection.sql` — Create `CatalogBranchProjection` table and backfill existing seeded branches
  - `apps/backend/src/brand/domain/{brand-events.ts,location-privacy.ts,tenant-bootstrap-strategy.ts}` — Brand/branch domain events (`BrandRegistered`, `BranchCreated`, `BranchSettingsUpdated`) and privacy/bootstrap domain logic
  - `apps/backend/src/brand/application/{brand-commands.ts,admin-brand-commands.ts,brand-onboarding-saga.ts,queries.ts}` — Brand/branch handlers, queries, and all-or-nothing `BrandOnboardingSaga`
  - `apps/backend/src/brand/infrastructure/branch-status-cache.ts` — Redis branch status cache
  - `apps/backend/src/brand/services/{brand-controller.ts,brand-routes.ts,brand-schemas.ts}` — Storefront (`/api/brands`), POS (`/api/pos/brands`), and Admin (`/api/admin/brands`) controllers, routers, and Zod v4 OpenAPI schemas
  - `apps/backend/src/catalog/application/{brand-catalog-sync-saga.ts,brand-catalog-onboarding-handlers.ts}` — `BranchCatalogSyncSaga` + `PricingPolicy` / `CatalogBranchProjection` bootstrap & hard-delete compensation
  - `apps/backend/src/iam/application/brand-onboarding-handlers.ts` — `StaffRole` / owner `RestaurantStaff` bootstrap & hard-delete compensation on `BrandRegistered`
  - `apps/backend/tests/unit/brand.location-privacy.spec.ts` & `apps/backend/tests/integration/brand-catalog.onboarding-sync-saga.int.spec.ts` — Unit & integration verification for privacy redaction, all-or-nothing onboarding rollback, and `BranchCatalogSyncSaga`
- **Handover Rationale & Compile-First Layer Plan (Why This Approach):**
  - **Architectural Rationale:** Separating `brand` from `catalog` isolates high-frequency storefront/POS menu and pricing changes from low-frequency brand/branch tenancy while eliminating all cross-context SQL writes across `brand`, `iam`, and `catalog`.
  - **Database & Seeds:** Add migration `013_catalog_branch_projection.sql` (backfilling seeded branches so `db:seed` requires no changes), run `pn db:migrate` and `pn db:bundle`.
  - **Domain & Application:** Implement `brand` domain events + `BrandOnboardingSaga` (with hard-delete compensation on failure), `iam` onboarding bootstrap/compensation handlers, and `catalog` `BranchCatalogSyncSaga` + `CatalogBranchProjection` read model.
  - **Infrastructure, DI & HTTP:** Register `brandModule` in `container.ts` with zero cross-context imports; mount `/api/brands`, `/api/pos/brands`, `/api/admin/brands`, `/api/catalog`, and `/api/pos/catalog` in `app.ts` with ADR-012 PBAC/JIT support ticket guards.
  - **Vitest Suites:** Verify privacy redaction & pricing strategies in `unit`, all-or-nothing onboarding rollback & `BranchCatalogSyncSaga` in `integration`, and full HTTP journeys in `smoke`.

---

## System Impact & Architectural Consequences

- **Functional Delta:**
  - Decomposed the monolithic `catalog` module into two cohesive bounded contexts: **`brand`** (`apps/backend/src/brand/`, owning `Restaurant`, `RestaurantBranch`, daily status cache, and home-kitchen address privacy) and **`catalog`** (`apps/backend/src/catalog/`, owning categories, menu items, modifiers, pricing policies, branch overrides, and compiled `MenuSnapshot` projections).
  - Eliminated all cross-context SQL writes and TypeScript imports across `brand`, `iam`, and `catalog` via `CatalogBranchProjection` (Migration `013`), `BranchCatalogSyncSaga`, and an all-or-nothing compensating `BrandOnboardingSaga` (`PgSagaRepository` + `ProcessedEvent`) that executes reverse-order hard `DELETE` rollbacks on failure so unique `handle` and `email` constraints remain immediately retryable.
  - Established clean greenfield channel/actor REST prefixes (`/api/brands`, `/api/catalog`, `/api/pos/brands`, `/api/pos/catalog`, `/api/admin/brands`) protected by ADR-012 PBAC and JIT support ticket guards.
- **Scalability, Performance & Operational Trade-offs:**
  - `CatalogRepository.rebuildAndPersistSnapshot` compiles menu snapshots exclusively from `CatalogBranchProjection` without joining `brand` tables, allowing `catalog` and `brand` to scale or extract into independent services with zero schema coupling.
  - Brand onboarding trades a single synchronous multi-table transaction for durable `_Saga_State` step tracking and reverse-order hard-delete compensation, guaranteeing atomic tenant provisioning across bounded contexts.
