// apps/backend/docs/adr/004-modular-di-containers.md

# ADR-004: Modular Per-Context Dependency Injection Containers

- **Status:** Proposed
- **Target Package:** `apps/backend` (`@foodapp/backend`)
- **Agent Protocol:** [Backend AI Agent Execution Protocol](./_templates/agent-protocol.md)
- **Tech Stack & System Baseline:** [Backend Tech Stack & System Baseline](./_templates/tech-stack.md)
- **Living Smoke Tests:** [Backend Living Smoke Tests](./_templates/curl-smoke-tests.txt)
- **Related ADRs:** `001-ARCHITECTURE.md`, `003-multi-tenant-rbac-rights-summary.md`

---

## 1. Context & Problem Statement

`apps/backend/src/container.ts` (~360 lines) currently registers every singleton, scoped handler, command/query bus binding, controller, and `EventBus` subscriber across all bounded contexts (`core`, `identity`, `catalog`, `ordering`, `ledger`) in a single monolithic file.

As new features and multi-region tax/compliance workflows are added, a single container file creates merge contention, obscures bounded-context ownership, and increases coupling prior to extracting contexts (`identity`, `catalog`, `ordering`, `ledger`) into standalone microservices.

---

## 2. Architectural Options & Trade-Off Comparison

| Option                       | Architectural Approach                                                                                         | Pros                                                                                                                                                                                                                                                         | Cons                                                                                                                                 |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **Option A _(Recommended)_** | **Typed Context Registrar Functions (`register<Context>Module(container)`)** + Context `EventBus` bootstrapper | Preserves full `@inferdi/inferdi` compile-time dependency/token inference across `rootContainer`, keeps zero runtime overhead, and makes extracting a context into its own microservice a matter of moving its module file and swapping cross-context ports. | `AppEnv` / `RequestScope` remains a single unified type in the monolith until microservice extraction.                               |
| **Option B**                 | **Separate Child/Sub-Containers per Context** mounted at Hono router level (`identityRoutes.use('*', ...)`).   | Hard runtime DI isolation per HTTP route prefix.                                                                                                                                                                                                             | Breaks shared `request` / `authz` / `commandBus` / `queryBus` scope resolution and duplicates `initDiScope` overhead per sub-router. |
| **Option C**                 | **Barrel Re-Export Split Only** (`container/singletons.ts`, `container/scoped.ts`, `container/buses.ts`)       | Minimal structural change.                                                                                                                                                                                                                                   | Splits by technical layer rather than bounded context, making future microservice extraction harder.                                 |

---

## 3. Compile-First Implementation Plan (Bottom-Up)

- **Slice 1 — Core Container Module (`src/core/infrastructure/core-container.ts`):**
  - [ ] Register infrastructure singletons (`db`, `redis`, `eventBus`, `eventStore`, `sagaRepo`) and scoped core services (`authz`, `commandBus`, `queryBus`).
- **Slice 2 — Bounded Context DI Modules (`src/contexts/<context>/infrastructure/<context>-container.ts`):**
  - [ ] `identity-container.ts`, `catalog-container.ts`, `ordering-container.ts`, and `ledger-container.ts` registering context repositories, handlers, controllers, bus bindings, and `EventBus` subscriptions.
- **Slice 3 — Root Composition (`src/container.ts`):**
  - [ ] Compose core and context DI modules cleanly in `rootContainer` and preserve `RequestScope` / `AppEnv` exports.

---

## 4. Verification & Post-Task Completion Gate

- [ ] **Pre-Code Handoff Checkpoint:** Generate `apps/backend/docs/adr/004-modular-di-containers-handoff.md` after Q&A and obtain explicit user approval before generating code.
- [ ] **Static Verification:** Run `pn fixed` and `pnpm --filter @foodapp/backend exec tsc --noEmit`.
- [ ] **Runtime `curl` Verification:** Execute smoke checks across `/api/health`, `/api/me`, `/api/restaurants`, `/api/pos/orders`, and `/api/ledger/restaurant`.
- [ ] **Post-Task Living Doc Sync (after user confirms tests pass):**
  - [ ] Promote `004-modular-di-containers-handoff.md` -> `apps/backend/docs/adr/004-modular-di-containers-summary.md`.
  - [ ] Update `_templates/tech-stack.md` with the new modular DI file layout.
  - [ ] Sync `_templates/curl-smoke-tests.txt` if needed.
