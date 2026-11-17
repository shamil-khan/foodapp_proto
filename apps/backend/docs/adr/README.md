# FoodApp (`fapp`) — Architecture Decision Records & Engineering Index

> **Platform Vision:** Multi-tenant Restaurant POS & Storefront platform built with Domain-Driven Design (DDD), CQRS, Event Sourcing, and microservice-ready bounded contexts—architected for **multi-region expansion** (UK, US, Australia, and additional markets via pluggable territorial tax/VAT and compliance strategies).

---

## 1. Platform Inception & Evolution

1. **Inception (`001-ARCHITECTURE.md`):**
   - Established the core monorepo (`pnpm` + Turborepo), PostgreSQL 18 + Redis 8 infrastructure, strict Bounded Context isolation (`identity`, `catalog`, `ordering`, `ledger`), Event Sourcing (`PgEventStore` + Mementos), CQRS (`InMemoryCommandBus` / `InMemoryQueryBus`), Saga orchestration (`OrderSettlementSaga`), and double-entry financial accounting (`FinancialLedgerAggregate`).
2. **API Contract & Cross-Cloud Readiness (`002-openapi-validation-cors.md`):**
   - Introduced runtime Zod v4 validation, OpenAPI 3.1 spec generation (`/api/doc`), Scalar interactive documentation (`/api/reference`), offline contract export (`contracts/openapi.json`), Better Auth `bearer()` sessions, and `.env`-driven cross-cloud CORS (`FRONTEND_ORIGINS`).
3. **Subdomain Multi-Tenancy & Dynamic PBAC (`003-multi-tenant-rbac-rights-summary.md`):**
   - Replaced raw tenant UUID logins with unique restaurant subdomains (`*.fapp.com`), normalized dynamic roles and granular rights (`StaffRole` + `StaffRolePermission`) with instant Redis cache invalidation (`role:perms:<roleId>`), and Specification/Decorator-backed cross-tenant & capability enforcement (`AuthorizationPolicy`).
4. **Multi-Region & Territorial Extensibility (Ongoing):**
   - Territorial rules (such as VAT/GST/Sales Tax strategies, currency formatting, and regional compliance) are isolated behind GoF **Strategy** abstractions so new markets (UK, US, AUS, etc.) can be onboarded without altering core ordering or double-entry ledger invariants.

---

## 2. Current Implemented Tech Stack (`@foodapp/backend`)

| Category                  | Technologies & Versions                                                                                        |
| :------------------------ | :------------------------------------------------------------------------------------------------------------- |
| **Runtime & HTTP**        | Node.js, Hono (`^4.13.16`), `@hono/node-server` (`^2.1.6`), `tsx` (`^4.23.15`), TypeScript (`^7.0.2`)          |
| **OpenAPI & Validation**  | `@hono/zod-openapi` (`^1.6.3`), `@scalar/hono-api-reference` (`^0.12.20`), `zod` (`^4.6.7`)                    |
| **DI & Observability**    | `@inferdi/inferdi` (`^6.1.1`), `@inferdi/hono` (`^6.1.1`), `@logtape/logtape` / `file` / `hono` (`^2.4.2`)     |
| **Authentication & RBAC** | `better-auth` (`^1.7.20` with `bearer()`, `phoneNumber` OTP, `admin`), HS256 POS shift JWTs, Redis-backed PBAC |
| **Data & Caching**        | PostgreSQL 18 (`@foodapp/db` typed query builders), Redis 8 (menu snapshots, auth sessions, role permissions)  |
| **Tooling**               | `pnpm` workspaces, Turborepo, Biome (`pn fixed`), Podman Compose                                               |

_(See [`./_templates/tech-stack.md`](./_templates/tech-stack.md) for exact DI lifetimes, environment variables, and bounded-context state.)_

---

## 3. ADR Log (Chronological)

| ADR                                                                                                      | Title                                                                 | Status                     | Notes                                                                                                      |
| :------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :------------------------- | :--------------------------------------------------------------------------------------------------------- |
| [`001-ARCHITECTURE.md`](./001-ARCHITECTURE.md)                                                           | Core DDD, Event Sourcing, CQRS & Double-Entry Ledger Baseline         | **Implemented**            | Historical architectural foundation                                                                        |
| [`002-openapi-validation-cors.md`](./002-openapi-validation-cors.md)                                     | OpenAPI 3.1, Zod v4 Validation, CORS & Static Exporter                | **Implemented**            | Runtime contracts & `/api/reference`                                                                       |
| [`003-multi-tenant-rbac-rights-summary.md`](./003-multi-tenant-rbac-rights-summary.md)                   | Subdomain Multi-Tenancy (`*.fapp.com`) & Dynamic Roles/Rights (PBAC)  | **Implemented & Verified** | Live subdomain routing + Redis PBAC (replaces `003-multi-tenant-authorization.md`)                         |
| [`004-modular-di-containers-summary.md`](./004-modular-di-containers-summary.md)                         | Modular Per-Context DI Composition in `src/container.ts`              | **Implemented & Verified** | Centralized `DI_TOKENS` + per-context container & bus registrars (replaces `004-modular-di-containers.md`) |
| [`005-decouple-order-settlement-saga.md`](./005-decouple-order-settlement-saga.md)                       | Decouple OrderSettlementSaga from Ledger Infrastructure               | **Proposed**               | Out-of-scope flaw captured during ADR-004                                                                  |
| [`006-ordering-route-auth-middleware.md`](./006-ordering-route-auth-middleware.md)                       | Enforce HTTP Route-Level Permission Guards in `order-routes.ts`       | **Proposed**               | Out-of-scope flaw captured after ADR-004 verification                                                      |
| [`007-flatten-business-unit-directory-hierarchy.md`](./007-flatten-business-unit-directory-hierarchy.md) | Flatten Business Unit Directory Hierarchy (`src/contexts/` -> `src/`) | **Implemented & Verified** | Relocated `identity`, `catalog`, `ordering`, and `ledger` directly under `src/`                            |

**- Multi-Region & Territorial Expansion (Planned):**

- Initially launched with UK VAT rules (`StandardUkVatStrategy` / `ZeroRatedUkVatStrategy`), with a future ADR planned to introduce region-specific tax/VAT and territorial compliance workflows for US, Australia, and additional markets.

---

## 4. Standardized ADR Workflow (`004+`)

All future ADRs follow a zero-boilerplate, living-doc workflow driven by [`./_templates/`](./_templates/):

1. **Blueprint ([`_templates/adr-template.md`](./_templates/adr-template.md)):** Copy to `XXX-<feature-slug>.md` to define the problem, compare options (Pros/Cons), and outline bottom-up slices.
2. **AI Execution Protocol ([`_templates/agent-protocol.md`](./_templates/agent-protocol.md)):** Enforces 1-question-at-a-time Q&A with Pros/Cons tables, an in-place **Pre-Code Handoff Section** (`## [WIP] Pre-Code Handoff Checkpoint` inside `XXX-<task-slug>.md`), compile-first bottom-up generation (`Domain` -> `Application` -> `Infrastructure/DI` -> `HTTP/OpenAPI`), 100-line chunking, and 5-file batching.
3. **Living System Baseline ([`_templates/tech-stack.md`](./_templates/tech-stack.md)):** Updated after every task with new packages, env vars, DI bindings, and bounded-context changes.
4. **Living Smoke Tests ([`_templates/curl-smoke-tests.txt`](./_templates/curl-smoke-tests.txt)):** Plain-text, copy-paste safe `curl` suite with expected HTTP statuses and JSON payloads, kept in sync whenever endpoints evolve.
