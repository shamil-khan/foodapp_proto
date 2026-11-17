// apps/backend/docs/adr/_templates/adr-template.md

# ADR-XXX: <Feature / Architectural Decision Title>

- **Status:** Proposed
- **Target Package:** `apps/backend` (`@foodapp/backend`)
- **Agent Protocol:** [Backend AI Agent Execution Protocol](./_templates/agent-protocol.md)
- **Tech Stack & System Baseline:** [Backend Tech Stack & System Baseline](./_templates/tech-stack.md)
- **Living Smoke Tests:** [Backend Living Smoke Tests](./_templates/curl-smoke-tests.txt)
- **Related ADRs:** `<e.g., 003-multi-tenant-authz.md>`

---

## 1. Context & Problem Statement

<Describe the business/technical problem, bounded contexts involved, event-sourcing/concurrency considerations, and current system gaps.>

---

## 2. Architectural Options & Trade-Off Comparison

| Option                       | Architectural Approach                                   | Pros              | Cons               |
| :--------------------------- | :------------------------------------------------------- | :---------------- | :----------------- |
| **Option A _(Recommended)_** | `<Describe primary recommended approach & GoF patterns>` | `<Key strengths>` | `<Key trade-offs>` |
| **Option B**                 | `<Describe alternative approach>`                        | `<Key strengths>` | `<Key trade-offs>` |
| **Option C**                 | `<Describe hybrid or third approach>`                    | `<Key strengths>` | `<Key trade-offs>` |

---

## 3. Compile-First Implementation Plan (Bottom-Up)

- **Slice 1 — Domain Layer (`src/contexts/<context>/domain/`):**
  - [ ] Immutable `DomainEvent` definitions, `AggregateRoot` state transitions, and domain `Specification`s.
- **Slice 2 — Application Layer (`src/contexts/<context>/application/`):**
  - [ ] Typed Commands/Queries, Handlers (`Result<T, DomainError>`), authorization checks, and Saga/Event handlers.
- **Slice 3 — Infrastructure & DI (`src/contexts/<context>/infrastructure/` & `src/container.ts`):**
  - [ ] Repository implementations (`@foodapp/db`), external adapters, and `@inferdi/inferdi` container bindings.
- **Slice 4 — HTTP & OpenAPI 3.1 Boundary (`src/contexts/<context>/services/`):**
  - [ ] Zod v4 `*-schemas.ts` (including `400`, `401`, `403`, `404`, `409` responses), thin `*-controller.ts`, and `*-routes.ts`.

---

## 4. Verification & Post-Task Completion Gate

- [ ] **Pre-Code Handoff Checkpoint:** Generate `apps/backend/docs/adr/XXX-<task-slug>-handoff.md` after Q&A and obtain explicit user approval before generating code.
- [ ] **Static Verification:** Run `pn fixed` and `pnpm --filter @foodapp/backend exec tsc --noEmit`.
- [ ] **Runtime `curl` Verification:** Execute happy-path and negative (`400`, `401`, `403`, `409`) `curl` checks against running server and `/api/reference`.
- [ ] **Post-Task Living Doc Sync (after user confirms tests pass):**
  - [ ] Promote `XXX-<task-slug>-handoff.md` -> `apps/backend/docs/adr/XXX-<task-slug>-summary.md`.
  - [ ] Update `_templates/tech-stack.md` with any new packages, DI bindings, or bounded-context changes.
  - [ ] Update `_templates/curl-smoke-tests.txt` with new/modified endpoints (and regenerate `_templates/agent-protocol.md` if new guidelines were added).
