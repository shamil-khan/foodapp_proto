# ADR-012: Unified IAM Policy Engine, Brand-Authorized JIT Support Tickets & HTTP Route Guards

- **Status:** Implemented & Verified
- **Target Package:** `apps/backend` (`@foodapp/backend`), `packages/db` (`@foodapp/db`)
- **Agent Protocol:** [Backend AI Agent Execution Protocol](./_templates/agent-protocol.md)
- **Tech Stack & System Baseline:** [Backend Tech Stack & System Baseline](./_templates/tech-stack.md)
- **Living Smoke Tests:** [Backend Living Smoke Tests](./_templates/curl-smoke-tests.txt)
- **Related ADRs:** `003-multi-tenant-rbac-rights-summary.md`, `004-modular-di-containers-summary.md`, `orders-billing-loyalty-architecture.md`
- **Supersedes:** `006-ordering-route-auth-middleware.md`

---

## Context & Problem Statement

Following the modular monolith decomposition (`orders`, `billing`, `loyalty`, `catalog`, `identity`), four security and architectural gaps remain across the HTTP boundary, permission evaluation engine, and platform support workflows:

- **Missing Fail-Fast HTTP Route Guards:** Protected endpoints across `orders` (`/api/pos/orders`, `/api/pos/orders/:id/settle`, `/api/pos/orders/sync`, `/api/orders/:id*`), `catalog` (`/api/brands/pos/*`), `billing` (`/api/billing/merchants/:restaurantId/settle`), `loyalty` (`/api/loyalty/governance`, `/api/loyalty/entries/:entryId/audit`), and `identity` (`/api/pos/auth/switch-branch`) do not attach authentication or permission middleware at the Hono router boundary. Unauthenticated (`SYSTEM`) callers reach controllers, `idempotencyMiddleware` Redis locks (`idemp:lock:anonymous:...`), or CQRS bus decorators and receive `400 MISSING_TENANT` or `403` instead of `401 Unauthorized`.
- **Wildcard `ALL_PERMISSIONS` on `PLATFORM_ADMIN`:** `resolveDefaultPermissionsForActor` grants `PLATFORM_ADMIN` wildcard `ALL_PERMISSIONS` (including customer `storefront:orders:place` and tenant `orders:*` rights), and `HasPermissionSpec` / `SameBranchSpec` bypass tenant scoping for platform staff—allowing unilateral interference in day-to-day brand operations without brand consent or audit distinction.
- **Flat `directPermissions TEXT[]` & Stale Role Cache:** `StaffBranchAssignment.directPermissions` is a flat array that cannot express explicit `DENY` overrides, audit reasons, or future time-bound grants (`validFrom` / `expiresAt`), and `UpdateStaffRoleHandler` invalidates `role:perms:{roleId}` without refreshing composite `staff:branch:perms:{staffId}:{branchId}` keys.
- **Customer Guest-to-Mobile-OTP Checkout UX & Cross-Device Sync:** Online customers must browse menus, calculate quotes (`POST /api/orders/preview`), and maintain a client-side basket without logging in first, authenticate via **Mobile OTP only** (no email required) at checkout, and sync their Redis basket (`cart:{userId}:{branchId}`) seamlessly across multiple logged-in devices (mobile app + laptop browser).

---

## Architectural Q&A Record (Options, Selected Decisions & Domain Commentary)

### Cross-Context Scope of Route Security Hardening

- **Options Evaluated:**
  - **Option A _(Selected)_:** Broaden this ADR to enforce fail-fast HTTP route-level auth/permission guards across **all bounded contexts** (`iam`, `support`, `catalog`, `orders`, `billing`, `loyalty`) in one cohesive pass, superseding `006-ordering-route-auth-middleware.md`.
  - **Option B:** Keep guards scoped only to `orders` (`/api/orders/*` and `/api/pos/orders/*`) and defer remaining contexts to a future ADR.
- **Selected:** **Option A**
- **Commentary:** POS staff, restaurant staff, and platform staff require fail-fast `401`/`403` authentication and permission checks at every HTTP router boundary before hitting controllers or acquiring Redis idempotency locks, whereas online customers must browse menus and build baskets unauthenticated before Mobile-OTP login at checkout.

### Guest Basket Persistence, Cross-Device Sync & Mobile-OTP Checkout Flow

- **Options Evaluated:**
  - **Option A:** Dual-key Redis cart (`cart:guest:{guestCartId}:{branchId}` for anonymous guests + `cart:{userId}:{branchId}` for authenticated users).
  - **Option B _(Selected)_:** Client-side guest basket (`localStorage` / Capacitor storage) before login; Mobile-OTP verification (`/api/auth/phone-number/send-otp` + `/api/auth/phone-number/verify`, no email required) right before order confirmation; and `requirePermission('storefront:orders:place')` on `GET/PUT /api/orders/cart/:branchId` + `POST /api/orders/checkout` so logged-in mobile and laptop devices sync automatically via `cart:{userId}:{branchId}` (`mergeWithExisting: true`).
  - **Option C:** Verify Mobile OTP inline inside `POST /api/orders/checkout`.
- **Selected:** **Option B**
- **Commentary:** Storing pre-login baskets on the client avoids unauthenticated Redis memory bloat/DoS, delivers `0ms` offline item additions, matches industry standards (Deliveroo, Uber Eats), and guarantees automatic cross-device sync once the customer authenticates via Mobile OTP on mobile and laptop browsers.

### Three-Actor Separation & Shared Endpoint Permission Evaluation

- **Options Evaluated:**
  - **Option A _(Selected)_:** Pure permission-based HTTP guards (`requirePermission(...)` and `requireAnyPermission(...)`) decoupled from role names, combined with replacing `PLATFORM_ADMIN` wildcard `ALL_PERMISSIONS` with explicit `platform:*` permissions.
  - **Option B:** Coarse `requireAuthenticatedActor()` (`401` only) on shared endpoints, deferring all capability checks to handlers while keeping `PLATFORM_ADMIN` on `ALL_PERMISSIONS`.
- **Selected:** **Option A**
- **Commentary:** Permissions are not bound to role names—roles are convenience bundles. Customers (`storefront:orders:place`, `storefront:orders:read`, `loyalty:read`, `loyalty:redeem`) can place/cancel eligible orders, track delivery/drop-point status, and browse menus; POS staff (`orders:*`, `catalog:*`, `branch:*`, `ledger:read`, `staff:*`) are strictly isolated from placing customer orders or viewing other brands' menus; and Platform staff are strictly restricted to platform governance and brand-authorized support actions.

### Normalized `StaffDirectPermission` Policy Storage & Zero-Fan-Out Cache Composition

- **Options Evaluated:**
  - **Option A _(Selected)_:** Create a dedicated normalized **`StaffDirectPermission`** table (`id`, `staffId`, `branchId`, `permission`, `effect` (`ALLOW` | `DENY`), `reason`, nullable `validFrom` / `expiresAt`, plus audit columns), drop the obsolete `directPermissions` column from `StaffBranchAssignment`, and compose `role:perms:{roleId}` + `staff:direct:{staffId}:{branchId}` on read in `RolePermissionCache`.
  - **Option B:** Add a second `revokedPermissions TEXT[]` array column on `StaffBranchAssignment` without per-permission audit reasons or time-bound windows.
- **Selected:** **Option A**
- **Commentary:** Greenfield schema allows clean policy normalization without legacy shims. Explicit `DENY` overrides role `ALLOW`, `validFrom`/`expiresAt` supports future time-bound shift grants, and composing role + direct caches on read eliminates stale staff permissions when custom roles are updated.
  // --- FILE: apps/backend/docs/adr/iam-policy-engine-jit-support-route-guards.md (Part 2 of 2) ---
  // --- FILE: apps/backend/docs/adr/iam-policy-engine-jit-support-route-guards.md (Part 2 of 2) ---
### Brand-Authorized JIT Support Ticket Approval & Catalog-Update Subscription Add-On

- **Options Evaluated:**
  - **Option A _(Selected)_:** Single-step creation and immediate `APPROVED` state by brand staff holding `brand:support:authorize` (`POST /api/pos/support-tickets`) with `expiresInHours` (1–24), `scopePermission`, `reason`, optional `assignedPlatformUserId`, and optional catalog-update attachment fields (`attachmentUrl`, `attachmentNote`), plus early revocation (`PATCH /api/pos/support-tickets/:ticketId/revoke`).
  - **Option B:** Two-step request (`PENDING_APPROVAL`) requiring a second brand staff member to approve before use.
- **Selected:** **Option A**
- **Commentary:** Platform staff cannot intervene in brand operations unilaterally—every brand-scoped intervention requires a DB-logged, unexpired `APPROVED` `SupportTicket` passed via `X-Support-Ticket-Id`. Furthermore, brands without dedicated catalog staff can subscribe to the catalog-update add-on service and attach a menu photo/message (`attachmentUrl` / `attachmentNote`) in the ticket so platform support can update their items or prices under `platform:support:catalog-override` with full `SupportTicketAuditLog` traceability.

### Scope of Brand-Scoped Support Ticket Operations

- **Options Evaluated:**
  - **Option A:** Limit JIT support tickets to branch status override, merchant B2B settlement, and merchant loyalty governance.
  - **Option B _(Selected)_:** Cover branch status override (`platform:support:branch-override`), catalog item creation & branch menu/price overrides (`platform:support:catalog-override`), merchant B2B settlement (`platform:support:billing-settle`), and merchant loyalty governance (`platform:support:loyalty-governance`) under `X-Support-Ticket-Id`, while global platform actions (`POST /api/admin/brands`, `PATCH /api/admin/brands/:restaurantId/status`, `POST /api/loyalty/entries/:entryId/audit`, and `PLATFORM`-scoped loyalty governance) use `PLATFORM_ADMIN`'s own `platform:*` permissions.
- **Selected:** **Option B**
- **Commentary:** Including `platform:support:catalog-override` directly enables the subscription catalog-update service workflow where brands upload menu images/instructions in a ticket for platform staff to execute safely.

### Bounded Context Placement (`iam` vs. `support`)

- **Options Evaluated:**
  - **Option A _(Selected)_:** Keep `apps/backend/src/iam/` strictly focused on Authentication, PBAC Policy Evaluation (`PermissionEvaluator`), and HTTP Access Middleware (`requirePermission`, `requireAnyPermission`, `requireApprovedSupportTicket`), and place the **`SupportTicket`** entity, attachments, commands/queries, and `SupportTicketAuditLog` repository in a dedicated **`apps/backend/src/support/`** bounded context implementing `iam`'s `SupportAccessPort`.
  - **Option B:** Keep `SupportTicket` inside `apps/backend/src/iam/`.
- **Selected:** **Option A**
- **Commentary:** Mirrors industry-standard separation (AWS IAM/STS access validation vs. AWS Support ticketing): `iam` enforces access policies and validates `X-Support-Ticket-Id` via `SupportAccessPort`, while `support` owns merchant collaborator requests and menu photo attachments without polluting `iam` with business workflow metadata.

---

## Compile-First Implementation Plan (Bottom-Up)

- **Slice — Database Schema, Codegen & Modular Seeds (`packages/db`):**
  - Add migration `012_iam_direct_permissions_and_support_tickets.sql` creating `StaffDirectPermission`, `SupportTicket` (including `scopePermission`, `reason`, `status`, `expiresAt`, `attachmentUrl`, `attachmentNote`), and `SupportTicketAuditLog` tables with full audit columns (`rowVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `deletedAt`, `deletedBy`), and dropping `StaffBranchAssignment.directPermissions`.
  - Run `pnpm --filter @foodapp/db db:migrate` and `pnpm --filter @foodapp/db db:bundle`.
  - Update `packages/db/src/types.ts` with `brand:support:authorize` (18th tenant right) and explicit `PLATFORM_ADMIN_PERMISSIONS` (`platform:restaurants:manage`, `platform:support:branch-override`, `platform:support:catalog-override`, `platform:support:billing-settle`, `platform:support:loyalty-governance`, `platform:loyalty:audit`) replacing wildcard `ALL_PERMISSIONS`.
  - Revise `packages/db/seeds/04_pbac_roles_staff.sql` and add `packages/db/seeds/07_support_tickets.sql` with updated role permissions, sample `StaffDirectPermission` overrides, and sample approved/expired `SupportTicket` records.
- **Slice — Unified `iam` & `support` Bounded Contexts (`apps/backend/src/iam/` & `apps/backend/src/support/`):**
  - Consolidate `identity/` into `iam/` (`domain/`, `application/`, `infrastructure/`, `services/`) and implement pure TypeScript `PermissionEvaluator` (`ALLOW`/`DENY` precedence + `validFrom`/`expiresAt` window check) plus zero-fan-out `RolePermissionCache` composition.
  - Implement `support/` bounded context (`SupportTicket` lifecycle, `CreateSupportTicketHandler`, `RevokeSupportTicketHandler`, `ListBrandSupportTicketsHandler`, `SupportTicketRepository` implementing `SupportAccessPort` + writing `SupportTicketAuditLog`, `SupportTicketController`, and `supportRoutes`).
  - Update `AuthorizationPolicy` and `ScopedRepository` to enforce strict three-actor separation (Customer vs. POS Staff vs. Platform Admin) and `SupportAccessContext` verification.
- **Slice — HTTP Route Guards Across All Contexts (`iam`, `support`, `catalog`, `orders`, `billing`, `loyalty`):**
  - Add `requireAnyPermission(...)` and `requireApprovedSupportTicket(...)` in `iam/services/auth-middleware.ts`.
  - Attach method-scoped `requirePermission` / `requireAnyPermission` / `requireApprovedSupportTicket` guards _before_ `idempotencyMiddleware` and controllers across `order-routes.ts`, `catalog-routes.ts`, `billing-routes.ts`, `loyalty-routes.ts`, `iam-routes.ts`, and `support-routes.ts` (including ownership check in `OrderController.streamOrderEvents`).
- **Slice — Unit, Integration & Smoke Test Suites (`apps/backend/tests/`):**
  - Add `tests/unit/iam.policy-evaluator.spec.ts` (`ALLOW`/`DENY` precedence, time windows, delegation guards).
  - Add `tests/unit/support.ticket-validation.spec.ts` (approval, expiry, tenant/branch mismatch, scope mismatch, self-approval rejection).
  - Add `tests/unit/shared.route-auth-guards.spec.ts` (`401`/`403` matrix across all protected routes and 3 actor worlds).
  - Add `tests/integration/support.jit-workflow.int.spec.ts` (end-to-end DB + Redis JIT support ticket approval, platform catalog/branch execution with `X-Support-Ticket-Id`, and `SupportTicketAuditLog` verification).
  - Update `tests/smoke/health-identity.smoke.test.ts`, `tests/smoke/pbac-roles.smoke.test.ts`, and `tests/smoke/orders-billing-loyalty.smoke.test.ts`.

---

## Verification & Post-Task Completion Gate

- Run `pnpm --filter @foodapp/backend fixed` and `pnpm --filter @foodapp/backend exec tsc --noEmit`.
- Run `pnpm --filter @foodapp/backend test:unit`, `pnpm --filter @foodapp/backend test:integration`, and `pnpm --filter @foodapp/backend test:smoke`.
- Promote `iam-policy-engine-jit-support-route-guards.md` to `Implemented & Verified`, mark `006-ordering-route-auth-middleware.md` as `Superseded`, and update `apps/backend/docs/adr/README.md`.

---

## System Impact & Architectural Consequences

- **Functional Delta:**
  - Replaced flat `StaffBranchAssignment.directPermissions` with a normalized policy-capable `StaffDirectPermission` model supporting explicit `ALLOW` and `DENY` overrides (`DENY` takes precedence over role grants) and optional `validFrom` / `expiresAt` shift windows, evaluated via a zero-fan-out `RolePermissionCache` composition.
  - Enforced strict three-actor separation across Customer (`storefront:*`, `loyalty:*`), POS/Brand Staff (per-branch PBAC), and Platform Staff (`platform:*` governance + brand-authorized JIT `SupportTicket` execution via `X-Support-Ticket-Id` with immutable `SupportTicketAuditLog` recording, including catalog-update subscription add-on attachments).
  - Applied fail-fast HTTP route-level authentication and permission guards across all bounded contexts (`iam`, `support`, `catalog`, `orders`, `billing`, `loyalty`) ahead of Redis idempotency locks and controllers, while keeping pre-login customer baskets client-side and syncing post-login carts across devices via Redis.
- **Scalability, Performance & Operational Trade-offs:**
  - Role permission updates invalidate a single `role:perms:{roleId}` Redis key instead of scanning per-staff cache entries, reducing Redis write amplification to `O(1)`.
  - Tenant-scoped platform interventions add one indexed primary-key lookup on `SupportTicket` and one append-only insert into `SupportTicketAuditLog` per guarded support request, trading negligible write overhead for full regulatory auditability and zero unilateral tenant mutation risk.
  - Extracting `support` as an isolated bounded context implementing `iam`'s `SupportAccessPort` preserves clean microservice extraction boundaries with zero circular DI coupling.
