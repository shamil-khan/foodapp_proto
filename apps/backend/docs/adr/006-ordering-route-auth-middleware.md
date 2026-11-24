// apps/backend/docs/adr/006-ordering-route-auth-middleware.md

# ADR-006: Enforce HTTP Route-Level Permission Guards in `order-routes.ts`

- **Status:** Superseded by [ADR-012: Unified IAM Policy Engine, Brand-Authorized JIT Support Tickets & HTTP Route Guards](./012-iam-policy-engine-jit-support-route-guards.md)
- **Target Package:** `apps/backend` (`@foodapp/backend`)
- **Agent Protocol:** [Backend AI Agent Execution Protocol](./_templates/agent-protocol.md)
- **Tech Stack & System Baseline:** [Backend Tech Stack & System Baseline](./_templates/tech-stack.md)
- **Living Smoke Tests:** [Backend Living Smoke Tests](./_templates/curl-smoke-tests.txt)
- **Related ADRs:** `003-multi-tenant-rbac-rights-summary.md`, `004-modular-di-containers-summary.md`

---

## 1. Context & Problem Statement

In `apps/backend/src/contexts/ordering/services/order-routes.ts`, none of the POS ordering endpoints (`GET /api/pos/orders`, `POST /api/pos/orders`, `POST /api/pos/orders/{id}/settle`) register `requirePermission(...)` middleware at the HTTP router boundary.

By contrast, `identity-routes.ts`, `catalog-routes.ts`, and `ledger-routes.ts` apply `requirePermission(...)` before delegating to controllers, returning `401 Unauthorized` for unauthenticated (`SYSTEM`) callers and `403 Forbidden` for actors lacking the required capability.

Without route-level `requirePermission(...)` guards in `order-routes.ts`:

1. An unauthenticated `GET /api/pos/orders` returns `400 MISSING_TENANT` instead of `401 Unauthorized`.
2. An unauthenticated `GET /api/pos/orders?restaurantId=<uuid>` bypasses `401` and hits `QueryBus`'s `AuthorizingQueryHandlerDecorator`, returning `403 INSUFFICIENT_RIGHTS` instead of `401 Unauthorized`.

---

## 2. Architectural Options & Trade-Off Comparison

| Option                       | Architectural Approach                                                                                                      | Pros                                                                                                                                                                                                                                 | Cons                                                                                                                                                                    |
| :--------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Option A _(Recommended)_** | **Add Per-Route `requirePermission(...)` Middleware in `order-routes.ts`** (`orders:read`, `orders:place`, `orders:settle`) | Matches `identity-routes.ts`, `catalog-routes.ts`, and `ledger-routes.ts` consistently; guarantees `401 Unauthorized` before controller parameter resolution while preserving `QueryBus` / `CommandBus` defense-in-depth decorators. | Requires carefully scoping middleware per HTTP method (`GET /` vs `POST /` vs `POST /:id/settle`) since `/` is shared between list and place routes.                    |
| **Option B**                 | **Global `/api/pos/orders/*` Authentication Middleware + Bus-Only Capability Checks**                                       | Single `requireAuthenticatedActor` middleware for all ordering routes; avoids per-method middleware wiring.                                                                                                                          | Relies solely on `CommandBus`/`QueryBus` decorators for capability checks, which throw `403` rather than handling HTTP status mapping uniformly across all controllers. |
| **Option C**                 | **Centralized OpenAPI Route-Security Wrapper (`createProtectedRoute`)**                                                     | Declaratively binds OpenAPI `security` metadata and Hono `requirePermission(...)` middleware in one place across all bounded contexts.                                                                                               | Broader cross-context refactor beyond `ordering`.                                                                                                                       |

---

## 3. Compile-First Implementation Plan (Bottom-Up)

- **Slice 1 — HTTP Middleware & Route Guards (`src/contexts/ordering/services/order-routes.ts`):**
  - [ ] Attach `requirePermission('orders:read')` to `GET /`, `requirePermission('orders:place')` to `POST /`, and `requirePermission('orders:settle')` to `POST /:id/settle`.
- **Slice 2 — OpenAPI Contract Consistency (`src/contexts/ordering/services/order-schemas.ts`):**
  - [ ] Verify `401` and `403` response schemas match actual runtime payloads across all three routes.

---

## 4. Verification & Post-Task Completion Gate

- [ ] **Pre-Code Handoff Checkpoint:** Generate `apps/backend/docs/adr/006-ordering-route-auth-middleware-handoff.md` after Q&A and obtain explicit user approval before generating code.
- [ ] **Static Verification:** Run `pn fixed` and `pnpm --filter @foodapp/backend exec tsc --noEmit`.
- [ ] **Runtime `curl` Verification:** Verify unauthenticated `GET /api/pos/orders`, `POST /api/pos/orders`, and `POST /api/pos/orders/{id}/settle` return `401 Unauthorized`, and authenticated calls succeed with `200`/`201`.
- [ ] **Post-Task Living Doc Sync (after user confirms tests pass):**
  - [ ] Promote `006-ordering-route-auth-middleware-handoff.md` -> `apps/backend/docs/adr/006-ordering-route-auth-middleware-summary.md`.
  - [ ] Update `_templates/curl-smoke-tests.txt`.
