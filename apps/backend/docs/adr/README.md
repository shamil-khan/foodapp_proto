# FoodApp (`fapp`) — Architecture Decision Records & Engineering Index

> **Platform Vision:** Multi-tenant Restaurant POS & Storefront platform built with Domain-Driven Design (DDD), CQRS, Event Sourcing, and microservice-ready bounded contexts—architected for **multi-region expansion** (UK, US, Australia, and additional markets via pluggable territorial tax/VAT and compliance strategies).

---

## 1. Platform Inception & Evolution

- **Core Foundation (`ADR-001` – `ADR-002`):** Established the `pnpm` + Turborepo monorepo, PostgreSQL 18 + Redis 8 infrastructure, bounded contexts (`identity`, `catalog`, `ordering`, `ledger`), Event Sourcing (`PgEventStore` + Mementos), CQRS, Saga orchestration (`OrderSettlementSaga`), double-entry accounting, Zod v4 runtime validation, OpenAPI 3.1 (`/api/doc`, `/api/reference`), and `.env`-driven CORS.
- **Subdomain Tenancy & Modular DI (`ADR-003` – `ADR-007`):** Introduced dynamic PBAC roles/rights (`StaffRole` + `StaffRolePermission`) with live Redis cache invalidation, modular `DI_TOKENS` container composition, and flattened bounded-context directories directly under `apps/backend/src/`.
- **Multi-Branch Brands, Home/Cloud Kitchens & Branch PBAC (`ADR-008` – `ADR-010`):** Evolved `"Restaurant"` into Brand + `"RestaurantBranch"` (`RESTAURANT_BRANCH`, `HOME_KITCHEN`, `CLOUD_KITCHEN`), added home-kitchen address privacy & drop points, 1-hour Redis `BUSY_PAUSED` status locks, `"PricingPolicy"` workflows, ingredient hashtags, declarative PBAC registries with per-branch `StaffBranchAssignment`, and automated Vitest smoke tests.

---

## 2. Core Tech Stack Overview

- **Runtime & HTTP:** Node.js, Hono, `@hono/node-server`, TypeScript
- **OpenAPI & Validation:** `@hono/zod-openapi`, `@scalar/hono-api-reference`, Zod v4
- **DI, Auth & Observability:** `@inferdi/inferdi`, `@inferdi/hono`, `better-auth`, HS256 POS shift JWTs, `@logtape/logtape`
- **Data & Caching:** PostgreSQL 18 (`@foodapp/db` typed query builders), Redis 8
- **Tooling & Testing:** `pnpm` workspaces, Turborepo, Biome (`pn fixed`), Podman Compose, Vitest (`test:smoke`)

_(See `package.json`, `apps/backend/src/container.ts`, and `/api/reference` for exact package versions, DI lifetimes, and live OpenAPI contracts.)_

---

// FILE: apps/backend/docs/adr/README.md (Section 3 — ADR Log Table)

## 3. ADR Log (Chronological)

| ADR         | Title & Document                                                                                                                       | Status                     | Summary                                                                                                                                                                                                                                    |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------- | :------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-001** | [Core DDD, Event Sourcing, CQRS & Double-Entry Ledger Baseline](./001-ARCHITECTURE.md)                                                 | **Implemented**            | Historical architectural foundation                                                                                                                                                                                                        |
| **ADR-002** | [OpenAPI 3.1, Zod v4 Validation, CORS & Static Exporter](./002-openapi-validation-cors.md)                                             | **Implemented**            | Runtime contracts & `/api/reference`                                                                                                                                                                                                       |
| **ADR-003** | [Subdomain Multi-Tenancy & Dynamic Roles/Rights (PBAC)](./003-multi-tenant-rbac-rights-summary.md)                                     | **Superseded**             | Superseded by `ADR-008` brand/branch routing & per-branch PBAC                                                                                                                                                                             |
| **ADR-004** | [Modular Per-Context DI Composition in `src/container.ts`](./004-modular-di-containers-summary.md)                                     | **Implemented & Verified** | Centralized `DI_TOKENS` & `defineBoundedContext` container modules                                                                                                                                                                         |
| **ADR-005** | [Decouple OrderSettlementSaga from Ledger Infrastructure](./005-decouple-order-settlement-saga.md)                                     | **Superseded**             | Resolved by `ADR-011` (`orders-billing-loyalty-architecture.md`) via strict bounded-context isolation                                                                                                                                      |
| **ADR-006** | [Enforce HTTP Route-Level Permission Guards in `order-routes.ts`](./006-ordering-route-auth-middleware.md)                             | **Superseded**             | Resolved by `ADR-012` across all bounded contexts                                                                                                                                                                                          |
| **ADR-007** | [Flatten Business Unit Directory Hierarchy (`src/contexts/` -> `src/`)](./007-flatten-business-unit-directory-hierarchy.md)            | **Implemented & Verified** | Relocated bounded contexts directly under `src/`                                                                                                                                                                                           |
| **ADR-008** | [Multi-Branch Restaurants, Home/Cloud Kitchens, Pricing Policies & Per-Branch PBAC](./008-multi-branch-restaurants.md)                 | **Implemented & Verified** | Brand -> Branch hierarchy, home/cloud kitchens, privacy redaction, 1h `BUSY_PAUSED` lock, `PricingPolicy`, & per-branch PBAC                                                                                                               |
| **ADR-009** | [Fix Backend TypeScript Build Errors & Enforce Strict Compilation](./009-fix-backend-typescript-build-errors.md)                       | **Implemented & Verified** | Resolved TS7 `erasableSyntaxOnly` & `@inferdi/inferdi` v6.1.1 errors across `@foodapp/db` and `@foodapp/backend`                                                                                                                           |
| **ADR-010** | [Automated API Smoke & Integration Testing Suite](./010-automated-api-smoke-testing.md)                                                | **Implemented & Verified** | Automated Vitest HTTP smoke & integration suites                                                                                                                                                                                           |
| **ADR-011** | [Multi-Channel Orders, Double-Entry Billing & Multi-Scope Loyalty Architecture](./orders-billing-loyalty-architecture.md)              | **Implemented & Verified** | Isolated `orders`, `billing`, and `loyalty` contexts, `decimal.js` double-entry GBP/VAT ledgers, named state machines, & offline POS sync                                                                                                  |
| **ADR-012** | [Unified IAM Policy Engine, Brand-Authorized JIT Support Tickets & HTTP Route Guards](./iam-policy-engine-jit-support-route-guards.md) | **Implemented & Verified** | Fail-fast HTTP permission guards across all contexts, `ALLOW`/`DENY` policy overrides, & brand-approved `X-Support-Ticket-Id` workflows                                                                                                    |
| **ADR-013** | [Decompose Catalog into Isolated `brand` and `catalog` Bounded Contexts with Saga Orchestration](./brand-catalog-decomposition.md)     | **Implemented & Verified** | Extracts `brand` tenancy/privacy from `catalog` menus/pricing, enforces zero cross-context SQL writes via `BrandOnboardingSaga` & `BranchCatalogSyncSaga`, & exposes `/api/brands`, `/api/catalog`, and `/api/pos/{brands,catalog}` routes |
| **Planned** | Multi-Region & Territorial Expansion                                                                                                   | **Planned**                | Initially launched with UK VAT rules; future ADR for US, Australia, & additional markets                                                                                                                                                   |

---

## 4. Standardized ADR Workflow

- **AI Execution Protocol & Embedded Template ([`000-agent-protocol.md`](./000-agent-protocol.md)):** Defines the end-to-end 5-step workflow (Turn-1 context snapshot, 1-question-at-a-time Q&A, `<feature-slug>.md` ADR generation, scaffold-first bottom-up implementation, and post-verification ADR finalization).
- **Automated Smoke Tests ([`apps/backend/tests/smoke/`](../../tests/smoke/)):** Self-contained Vitest end-to-end API smoke suite (`pnpm --filter @foodapp/backend test:smoke`) kept in sync whenever endpoints evolve.
